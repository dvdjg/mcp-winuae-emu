#!/usr/bin/env node
/**
 * Verificacion de `monitor print` (e9k-style) + resolucion de simbolos via .map.
 *
 * Uso: node scripts/verify-print.mjs
 * Env: WINUAE_PATH, WINUAE_CONFIG.
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { passed: [], failed: [] };
const pass = (t, d = '') => { results.passed.push(t); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, d = '') => { results.failed.push(t); console.log(`  [FAIL] ${t} - ${d}`); };
async function mon(p, cmd, t = 6000) { return Buffer.from(await p.sendMonitorCommand(cmd, t), 'hex').toString('utf8'); }

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

  // T1: print 0x4 (SysBase pointer, long)
  let s = await mon(p, 'print 0x4 size=32');
  const m = /value=0x([0-9a-fA-F]+)/.exec(s);
  const sysbase = m ? parseInt(m[1], 16) : 0;
  if (m && sysbase !== 0) pass('T1 print addr (SysBase)', s.trim());
  else fail('T1 print addr (SysBase)', s.trim());

  // T2: print 0x0 (reset vector, long) -> suele ser 0xfc0000 (ROM)
  s = await mon(p, 'print 0x0 size=32');
  if (/value=0x[0-9a-fA-F]{8}/.test(s)) pass('T2 print 0x0', s.trim());
  else fail('T2 print 0x0', s.trim());

  // T3: print *0x4 (deref de SysBase -> primer long del ExecBase)
  s = await mon(p, 'print *0x4 size=32');
  if (/value=0x[0-9a-fA-F]{8}/.test(s)) pass('T3 print deref (*0x4)', s.trim());
  else fail('T3 print deref (*0x4)', s.trim());

  // T4: print byte y word
  s = await mon(p, 'print 0x4 size=16');
  if (/value=0x[0-9a-fA-F]{4}/.test(s)) pass('T4 print size=16', s.trim());
  else fail('T4 print size=16', s.trim());
  s = await mon(p, 'print 0x4 size=8');
  if (/value=0x[0-9a-fA-F]{2}/.test(s)) pass('T5 print size=8', s.trim());
  else fail('T5 print size=8', s.trim());

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message);
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}
