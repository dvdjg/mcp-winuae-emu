#!/usr/bin/env node
/**
 * Verificacion del debug peripheral AMPLIADO de WinUAE-DBG (e9k-inspired):
 * secciones commit (0xB70014/18/1C), descripciones de checkpoint (0xB70100),
 * contadores nombre/valor (0xB70200/0xB70300), 0xDEAD (0xB70024) y smoke start
 * (0xB70028). Reusa el patrón de verify-debug-peripheral.mjs.
 *
 * Uso: node scripts/verify-debug-peripheral-ext.mjs
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

  // T1: secciones commit (.text / .data / .bss)
  await p.writeMemory(0xB70014, Buffer.from([0, 0, 0xc0, 0x00])); // base
  await p.writeMemory(0xB70018, Buffer.from([0, 0, 0, 0]));       // type 0 = text
  await p.writeMemory(0xB7001C, Buffer.from([0, 0, 0x10, 0x00])); // size
  await p.writeMemory(0xB70014, Buffer.from([0, 0, 0xd0, 0x00])); // base
  await p.writeMemory(0xB70018, Buffer.from([0, 0, 0, 1]));       // type 1 = data
  await p.writeMemory(0xB7001C, Buffer.from([0, 0, 0x20, 0x00])); // size
  await p.writeMemory(0xB70014, Buffer.from([0, 0, 0xe0, 0x00])); // base
  await p.writeMemory(0xB70018, Buffer.from([0, 0, 0, 2]));       // type 2 = bss
  await p.writeMemory(0xB7001C, Buffer.from([0, 0, 0x40, 0x00])); // size
  let s = await mon(p, 'debugperiph');
  const mText = s.match(/text=0x([0-9a-fA-F]+)/);
  const mData = s.match(/data=0x([0-9a-fA-F]+)/);
  const mBss = s.match(/bss=0x([0-9a-fA-F]+)/);
  if (mText && mData && mBss && mText[1] === '0000c000' && mData[1] === '0000d000' && mBss[1] === '0000e000')
    pass('T1 secciones commit', `text=0x${mText[1]} data=0x${mData[1]} bss=0x${mBss[1]}`);
  else fail('T1 secciones commit', `text=0x${mText?.[1]} data=0x${mData?.[1]} bss=0x${mBss?.[1]}`);

  // T2: descripcion de checkpoint (0xB70100 + slot*4 -> pointer a string en RAM)
  await p.writeMemory(0x50000, Buffer.from('UPLOAD_TILES\0', 'ascii'));
  await p.writeMemory(0xB70100, Buffer.from([0, 0x05, 0, 0]));  // slot 0 -> ptr 0x50000
  await p.writeMemory(0xB70020, Buffer.from([0, 0, 0, 0]));     // checkpoint slot 0
  await p.writeMemory(0xB70020, Buffer.from([0, 0, 0, 3]));     // checkpoint slot 3
  const cp = await mon(p, 'debugperiph checkpoints');
  if (cp.includes('[0]') && cp.includes('desc="UPLOAD_TILES"'))
    pass('T2 checkpoint description', cp.split('\n').find(l => l.includes('[0]')).trim());
  else fail('T2 checkpoint description', cp.split('\n').slice(0, 4).join(' | '));

  // T3: contadores (nombre + valor)
  await p.writeMemory(0x50010, Buffer.from('frames_uploaded\0', 'ascii'));
  await p.writeMemory(0xB70200, Buffer.from([0, 0x05, 0x00, 0x10])); // slot 0 -> name_ptr 0x50010
  await p.writeMemory(0xB70300, Buffer.from([0, 0, 0, 42]));        // slot 0 value = 42
  await p.writeMemory(0xB70304, Buffer.from([0, 0, 0, 7]));         // slot 1 value = 7
  const cnt = await mon(p, 'debugperiph counters');
  if (cnt.includes('[0]') && cnt.includes('value=42') && cnt.includes('name="frames_uploaded"') && cnt.includes('[1]') && cnt.includes('value=7'))
    pass('T3 contadores', cnt.split('\n').filter(l => l.includes('[0]') || l.includes('[1]')).join(' | '));
  else fail('T3 contadores', cnt.split('\n').slice(0, 4).join(' | '));

  // T4: 0xDEAD -> el debugger se detiene (breakpoint en el PC actual)
  await p.writeMemory(0xB70024, Buffer.from([0, 0, 0xde, 0xad]));
  await p.continue();
  const stop = await p.waitForStop(4000).catch(() => 'timeout');
  const logOk = gdbLog().includes('0xDEAD');
  if (!String(stop).includes('timeout') && logOk)
    pass('T4 0xDEAD salida del debugger', `stop=${String(stop).slice(0, 40)}`);
  else fail('T4 0xDEAD salida del debugger', `stop=${String(stop).slice(0, 40)} log0xDEAD=${logOk}`);
  await p.continue(); await sleep(200); await p.pause();

  // T5: smoke/profile start (0xB70028) -> log del hook
  await p.writeMemory(0xB70028, Buffer.from([1, 2, 3, 4]));
  await sleep(200);
  if (gdbLog().includes('smoke/profile start requested'))
    pass('T5 smoke/profile hook', 'evento registrado en el log');
  else fail('T5 smoke/profile hook', 'log sin el evento');

  // T6: regresión rápida de consola + args (no romper lo existente)
  for (const c of 'EXT_OK') await p.writeMemory(0xB70000, Buffer.from([c.charCodeAt(0)]));
  await p.writeMemory(0xB70000, Buffer.from([0]));
  await mon(p, 'debugperiph arg 1 0x0badc0de');
  const arg = (await p.readMemory(0xB7E904, 4)).readUInt32BE(0);
  if (gdbLog().includes('DBGPERIPH: EXT_OK') && arg === 0x0badc0de)
    pass('T6 consola+args regresion', `arg1=0x${arg.toString(16)}`);
  else fail('T6 consola+args regresion', `arg=0x${arg.toString(16)} log=${gdbLog().split('\n').filter(l => l.includes('EXT_OK')).length}`);

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message);
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}
