#!/usr/bin/env node
/**
 * Verificacion del comando `monitor train` (e9k): romper cuando una escritura
 * cambia un valor de <from> a <to> en cualquier direccion + ignore list.
 * Usa el patrÃ³n de verify-monitor-extensions T6 (GDB write mientras el CPU
 * corre, que sÃ­ dispara el memwatch).
 *
 * Uso: node scripts/verify-train.mjs
 * Env: WINUAE_PATH, WINUAE_CONFIG.
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { passed: [], failed: [] };
const pass = (t, d = '') => { results.passed.push(t); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, d = '') => { results.failed.push(t); console.log(`  [FAIL] ${t} - ${d}`); };

async function mon(p, cmd, t = 6000) {
  const r = await p.sendMonitorCommand(cmd, t);
  return Buffer.from(r, 'hex').toString('utf8');
}

const WINUAE_PATH = process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin';
const WINUAE_CONFIG = process.env.WINUAE_CONFIG || 'C:/Users/dvdjg/AppData/Local/Temp/opencode/a500-headless.uae';
process.env.WINUAE_EXE = 'winuae-gdb.exe';
process.env.WINUAE_HEADLESS = '1';
process.env.WINUAE_USE_LEGACY_LAUNCH = '1';
process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '7000';
const TGT = 0x40000;

const conn = new WinUAEConnection({ winuaePath: WINUAE_PATH, configFile: WINUAE_CONFIG, gdbPort: 2345 });
try {
  await conn.connect();
  await sleep(6000);
  const p = conn.getProtocol();
  await p.continue(); await sleep(400); await p.pause();

  // T1: train instala un watchpoint any-address from=1 to=2
  let s = await mon(p, 'train 1 2 size=32');
  if (s.startsWith('OK train')) pass('T1 train instala watch', s.trim());
  else fail('T1 train instala watch', s.trim());

  // T2: dejar 0x40000=1, luego escribir 2 mientras el CPU corre -> rompe
  await p.writeMemory(TGT, Buffer.from([0, 0, 0, 1]));
  await p.continue(); await sleep(250);
  await p.writeMemory(TGT, Buffer.from([0, 0, 0, 2]));
  await sleep(150);
  const stop = await p.pause();
  await sleep(100);
  const last = await mon(p, 'watch last');
  const hit = String(stop).startsWith('T05watch') && /addr=0x0004000[0-3]/.test(last);
  if (hit) pass('T2 train rompe al cambiar 1->2', `${String(stop).slice(0, 12)} ${last.trim()}`);
  else fail('T2 train rompe al cambiar 1->2', `stop=${String(stop).slice(0, 30)} last=${last.trim()}`);

  // T3: train ignore + no vuelve a romper en esa direccion
  s = await mon(p, 'train ignore');
  if (!s.startsWith('OK')) { fail('T3 train ignore', s.trim()); }
  else {
    await p.writeMemory(TGT, Buffer.from([0, 0, 0, 1])); // reset a 1 (no rompe: from=1->to=2 requiere old=1, new=2; old aqui es 2)
    await p.continue(); await sleep(200);
    await p.writeMemory(TGT, Buffer.from([0, 0, 0, 2]));
    await sleep(150);
    const stop2 = await p.pause();
    await sleep(100);
    const last2 = await mon(p, 'watch last');
    const ignored = !String(stop2).startsWith('T05watch');
    if (ignored) pass('T3 train ignore', 'no rompe en la direccion ignorada');
    else fail('T3 train ignore', `rompio: ${String(stop2).slice(0, 30)} last=${last2.trim()}`);
  }

  // T4: train clear -> vuelve a romper
  s = await mon(p, 'train clear');
  if (!s.startsWith('OK')) { fail('T4 train clear', s.trim()); }
  else {
    await p.writeMemory(TGT, Buffer.from([0, 0, 0, 1]));
    await p.continue(); await sleep(200);
    await p.writeMemory(TGT, Buffer.from([0, 0, 0, 2]));
    await sleep(150);
    const stop3 = await p.pause();
    await sleep(100);
    const last3 = await mon(p, 'watch last');
    if (String(stop3).startsWith('T05watch') && /addr=0x0004000[0-3]/.test(last3))
      pass('T4 train clear', 'vuelve a romper tras limpiar la ignore list');
    else fail('T4 train clear', `stop=${String(stop3).slice(0, 30)} last=${last3.trim()}`);
  }

  // T5: watch list muestra el nodo train
  const wl = await mon(p, 'watch list');
  const trainLine = wl.split('\n').find(l => l.includes('WATCH') && l.includes('mustchange=1'));
  if (trainLine) pass('T5 watch list incluye train', trainLine.trim());
  else fail('T5 watch list incluye train', wl.trim());

  // cleanup
  await mon(p, 'watch clear');
  await mon(p, 'train clear');

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message);
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}

