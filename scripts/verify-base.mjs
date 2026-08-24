#!/usr/bin/env node
/**
 * Verificacion de `monitor base` (e9k-style section bases for symbol resolution).
 *
 * Uso: node scripts/verify-base.mjs
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

  // T1: base sin args -> muestra text/data/bss (o aviso)
  let s = await mon(p, 'base');
  const hasTxt = /text=0x/.test(s);
  if (hasTxt) pass('T1 base query', s.split('\n')[0].trim());
  else fail('T1 base query', s.trim());

  // T2: fijar text/data/bss
  s = await mon(p, 'base text 0xc0cb88');
  if (!s.startsWith('OK')) { fail('T2 base text set', s.trim()); }
  else {
    s = await mon(p, 'base data 0xc0f0a8');
    const okData = s.startsWith('OK');
    s = await mon(p, 'base bss 0xc0f390');
    const okBss = s.startsWith('OK');
    const q = await mon(p, 'base');
    if (okData && okBss && q.includes('text=0x00c0cb88') && q.includes('data=0x00c0f0a8') && q.includes('bss=0x00c0f390'))
      pass('T2 base set text/data/bss', q.split('\n').map(l => l.trim()).join(' | '));
    else fail('T2 base set text/data/bss', q.trim());
  }

  // T3: base clear
  s = await mon(p, 'base clear');
  const q2 = await mon(p, 'base');
  if (s.startsWith('OK') && q2.includes('text=0x00000000'))
    pass('T3 base clear', q2.split('\n')[0].trim());
  else fail('T3 base clear', `${s.trim()} | ${q2.trim()}`);

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message);
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}
