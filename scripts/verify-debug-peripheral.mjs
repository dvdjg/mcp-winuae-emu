#!/usr/bin/env node
/**
 * Verificación del debug peripheral de WinUAE-DBG (e9k-inspired "Amiga Debug
 * Peripherals"), mapeado en 0xB70000:
 *   consola (0xB70000), breakpoint (0xB70004), secciones, checkpoint (0xB70020),
 *   debug args (0xB7E900..) y contador de ciclos (0xB7E928).
 *
 * Uso: node scripts/verify-debug-peripheral.mjs
 * Env: WINUAE_PATH, WINUAE_CONFIG (defaults abajo).
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import fs from 'fs';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { passed: [], failed: [] };
const pass = (t, d = '') => { results.passed.push(t); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, d = '') => { results.failed.push(t); console.log(`  [FAIL] ${t} - ${d}`); };

async function mon(p, cmd, t = 6000) {
  const r = await p.sendMonitorCommand(cmd, t);
  return Buffer.from(r, 'hex').toString('utf8');
}
function gdbLog() {
  return fs.readFileSync(path.join(process.env.TEMP, 'winuae-gdb.log'), 'utf8');
}

const WINUAE_PATH = process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin';
const WINUAE_CONFIG = process.env.WINUAE_CONFIG || 'C:/Users/dvdjg/AppData/Local/Temp/opencode/a500-headless.uae';

process.env.WINUAE_EXE = 'winuae-gdb.exe';
process.env.WINUAE_HEADLESS = '1';
process.env.WINUAE_USE_LEGACY_LAUNCH = '1';
process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '7000';

const conn = new WinUAEConnection({ winuaePath: WINUAE_PATH, configFile: WINUAE_CONFIG, gdbPort: 2345 });
try {
  await conn.connect();
  await sleep(6000);
  const p = conn.getProtocol();
  await p.continue(); await sleep(400); await p.pause();

  // T1: debugperiph mapeado
  let s = await mon(p, 'debugperiph');
  if (s.includes('mapped=1') && s.includes('base=0x00b70000')) pass('T1 debugperiph mapeado', s.split('\n')[0]);
  else fail('T1 debugperiph mapeado', s.split('\n')[0]);

  // T2: consola (escribir caracteres -> log)
  for (const c of 'HelloPeriph') await p.writeMemory(0xB70000, Buffer.from([c.charCodeAt(0)]));
  await p.writeMemory(0xB70000, Buffer.from([0])); // flush
  await sleep(200);
  if (gdbLog().includes('DBGPERIPH: HelloPeriph')) pass('T2 consola', 'texto capturado en el log');
  else fail('T2 consola', gdbLog().split('\n').filter(l => l.includes('DBGPERIPH')).slice(-3).join(' | '));

  // T3: contador de ciclos (0xB7E928) mientras el CPU corre
  await p.continue();
  await sleep(300);
  const c1 = (await p.readMemory(0xB7E928, 4)).readUInt32BE(0);
  await sleep(400);
  const c2 = (await p.readMemory(0xB7E928, 4)).readUInt32BE(0);
  await p.pause();
  if (c1 > 0 && c2 > c1) pass('T3 ciclo contador', `0x${c1.toString(16)} -> 0x${c2.toString(16)}`);
  else fail('T3 ciclo contador', `c1=0x${c1.toString(16)} c2=0x${c2.toString(16)}`);

  // T4: debug args (set + read)
  s = await mon(p, 'debugperiph arg 0 0x12345678');
  const arg = (await p.readMemory(0xB7E900, 4)).readUInt32BE(0);
  if (arg === 0x12345678) pass('T4 debug arg', `0xB7E900 = 0x${arg.toString(16)}`);
  else fail('T4 debug arg', `0x${arg.toString(16)} != 0x12345678`);

  // T5: checkpoint (escribir slot 5)
  await p.writeMemory(0xB70020, Buffer.from([0, 0, 0, 5]));
  const dpStatus = await mon(p, 'debugperiph');
  const cp = await mon(p, 'debugperiph checkpoints');
  if (cp.includes('[5]')) pass('T5 checkpoint', cp.split('\n')[0]);
  else fail('T5 checkpoint', `slot=${(dpStatus.match(/checkpoint_slot=(\d+)/) || [])[1]} cp="${cp.trim()}"`);

  // T6: breakpoint via periférico (0xB70004 = 0x00020000)
  await p.writeMemory(0xB70004, Buffer.from([0, 2, 0, 0]));
  await sleep(100);
  const code = Buffer.from('700813c000b70000700513c000b70000700c13c000b70000700c13c000b70000700f13c000b70000700013c000b70000203900b7e92823c00004000060fe', 'hex');
  await p.writeMemory(0x20000, code);
  await p.writeRegister(17, 0x20000); // PC
  await p.continue();
  const stop = await p.waitForStop(5000).catch(() => 'timeout');
  if (!String(stop).includes('timeout')) pass('T6 breakpoint via periférico', String(stop).slice(0, 40));
  else fail('T6 breakpoint via periférico', String(stop).slice(0, 40));

  // T7: end-to-end (consola "World" + ciclo contador escrito a RAM) en 0x21000
  // (evita el breakpoint de 0x20000 que dejó T6). Empieza con MOVE.W #$2700,SR
  // (desactiva interrupciones) para que una IRQ no secuestre el CPU.
  const code7 = Buffer.from('46fc2700705713c000b70000706f13c000b70000707213c000b70000706c13c000b70000706413c000b70000700013c000b70000203900b7e92823c00004000060fe', 'hex');
  await p.writeMemory(0x21000, code7);
  await p.writeRegister(17, 0x21000);
  await p.continue(); await sleep(300); await p.pause();
  const ram = (await p.readMemory(0x40000, 4)).readUInt32BE(0);
  const consoleOk = gdbLog().includes('DBGPERIPH: World');
  if (consoleOk && ram > 0) pass('T7 end-to-end', `consola "World" OK, RAM(0x40000)=0x${ram.toString(16)}`);
  else fail('T7 end-to-end', `console=${consoleOk} ram=0x${ram.toString(16)}`);

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message);
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}
