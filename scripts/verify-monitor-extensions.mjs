#!/usr/bin/env node
/**
 * Verificación de las extensiones de monitor de WinUAE-DBG v2.1:
 *   monitor status / watch / protect / rewind
 *
 * Lanza winuae-gdb.exe (x86) headless, conecta por GDB RSP y ejecuta cada
 * test. Requiere una config con Kickstart válida (ver env vars abajo).
 *
 * Uso:
 *   node scripts/verify-monitor-extensions.mjs
 *
 * Env:
 *   WINUAE_PATH  (default C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin)
 *   WINUAE_EXE   (default winuae-gdb.exe — el build x86, ver nota x64)
 *   WINUAE_CONFIG (default C:/Amiga/A500-Dev.uae)
 *
 * NOTA x64: el build x64 de WinUAE-DBG tiene un problema PREEXISTENTE (no
 * causado por estas extensiones) que impide el handshake GDB durante el boot
 * y puede provocar un crash en la región JIT/compemu. Usar el build x86.
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';

const CONFIG = {
  winuaePath: process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'C:/Amiga/A500-Dev.uae',
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const results = { passed: [], failed: [], skipped: [] };
const log = (m) => console.log(`[INFO] ${m}`);
const pass = (t, d = '') => { results.passed.push({ t, d }); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, e) => { results.failed.push({ t, e: String(e?.message || e) }); console.log(`  [FAIL] ${t} - ${e?.message || e}`); };
const skip = (t, r) => { results.skipped.push({ t, r }); console.log(`  [SKIP] ${t} - ${r}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mon(proto, cmd, timeout = 10000) {
  const reply = await proto.sendMonitorCommand(cmd, timeout);
  return Buffer.from(reply, 'hex').toString('utf8');
}

async function main() {
  console.log('============================================================');
  console.log('  VERIFICACIÓN extensiones monitor WinUAE-DBG v2.1');
  console.log('============================================================');
  log(`WinUAE: ${CONFIG.winuaePath}`);
  log(`Config: ${CONFIG.configFile}`);
  process.env.WINUAE_HEADLESS = '1';
  process.env.WINUAE_USE_LEGACY_LAUNCH = '1';
  process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '7000';

  const conn = new WinUAEConnection(CONFIG);
  try {
    await conn.connect();
    log('Conectado. Esperando arranque...');
    await sleep(6000);
    const p = conn.getProtocol();
    await p.continue();
    await sleep(500);
    await p.pause();

    // T1: status
    let s = await mon(p, 'status');
    let ok = true;
    for (const key of ['cycles=', 'frame=', 'vpos=', 'hpos=', 'warp=', 'baseText=', 'breakpoints=', 'watchpoints=', 'protects=', 'rewind=']) {
      if (!s.includes(key)) ok = false;
    }
    ok ? pass('T1 status', 'todos los campos presentes') : fail('T1 status', s);

    // T2: watch add / list / del
    s = await mon(p, 'watch 0x1000 w size=32 src=cpudw');
    if (!s.startsWith('OK watch [')) fail('T2a watch add', s);
    else pass('T2a watch add', s.trim());
    s = await mon(p, 'watch list');
    if (!s.includes('0x00001000')) fail('T2b watch list', s);
    else pass('T2b watch list', 'muestra watchpoint con src=cpu');
    s = await mon(p, 'watch del 0');
    if (!s.startsWith('OK')) fail('T2c watch del', s);
    else pass('T2c watch del', s.trim());

    // T3: protect block (la escritura M se bloquea MIENTRAS el CPU corre)
    const TGT = 0x50000;
    const orig = await p.readMemory(TGT, 4);
    s = await mon(p, `protect ${TGT.toString(16)} block size=16 src=cpudw`);
    if (!s.startsWith('OK protect [')) fail('T3a protect block add', s);
    else pass('T3a protect block add', s.trim());
    await p.continue();
    await sleep(300);
    await p.writeMemory(TGT, Buffer.from([0xbe, 0xef]));
    await sleep(100);
    await p.pause();
    await sleep(100);
    const t1 = await p.readMemory(TGT, 4);
    if (t1.readUInt16BE(0) === 0xbeef) fail('T3b protect block', `no bloqueado: ${t1.toString('hex')}`);
    else pass('T3b protect block', `escritura bloqueada (${t1.toString('hex')})`);
    s = await mon(p, 'protect list');
    if (!s.includes('PROTECT')) fail('T3c protect list', s);
    else pass('T3c protect list', 'muestra el protect');
    s = await mon(p, 'protect clear');
    if (!s.startsWith('OK')) fail('T3d protect clear', s);
    else pass('T3d protect clear', s.trim());

    // T4: protect set (la escritura M se fuerza a 0x1234 MIENTRAS el CPU corre)
    s = await mon(p, `protect ${TGT.toString(16)} set=0x1234 size=16 src=cpudw`);
    if (!s.startsWith('OK protect [')) fail('T4a protect set add', s);
    else pass('T4a protect set add', s.trim());
    await p.continue();
    await sleep(300);
    await p.writeMemory(TGT, Buffer.from([0xbe, 0xef]));
    await sleep(100);
    await p.pause();
    await sleep(100);
    const t2 = await p.readMemory(TGT, 4);
    if (t2.readUInt16BE(0) === 0x1234) pass('T4b protect set', `escritura forzada a 0x1234`);
    else fail('T4b protect set', `no forzado: ${t2.toString('hex')}`);
    await mon(p, 'protect clear');
    await p.writeMemory(TGT, orig);

    // T5: rewind (captura — seguro; el restore es experimental y puede crashear)
    s = await mon(p, 'rewind start');
    if (!s.startsWith('OK rewind capture')) fail('T5a rewind start', s);
    else pass('T5a rewind start', s.trim());
    s = await mon(p, 'rewind status');
    if (!s.includes('input_record=')) fail('T5b rewind status', s);
    else pass('T5b rewind status', s.trim());
    s = await mon(p, 'rewind stop');
    if (!s.startsWith('OK rewind capture')) fail('T5c rewind stop', s);
    else pass('T5c rewind stop', s.trim());

    // T7: trace
    s = await mon(p, 'trace status');
    if (!s.includes('trace=')) fail('T7a trace status', s);
    else pass('T7a trace status', s.trim());
    s = await mon(p, 'trace off');
    if (!s.startsWith('OK trace')) fail('T7b trace off', s);
    else pass('T7b trace off', s.trim());
    s = await mon(p, 'trace on');
    if (!s.startsWith('OK trace')) fail('T7c trace on', s);
    else pass('T7c trace on', s.trim());

    // T6: watch hit real (escritura M mientras el CPU corre) + watch last
    const TGT6 = TGT;
    s = await mon(p, `watch ${TGT6.toString(16)} w size=16 src=cpudw`);
    if (!s.startsWith('OK watch [')) fail('T6a watch add', s);
    else pass('T6a watch add', s.trim());
    await p.continue();
    await sleep(300);
    await p.writeMemory(TGT6, Buffer.from([0xbe, 0xef]));
    await sleep(150);
    const stop6 = await p.pause();
    await sleep(100);
    s = await mon(p, 'watch last');
    const hit6 = stop6.startsWith('T05watch') && s.includes('src=cpu') &&
      (s.includes('addr=0x00050000') || s.includes('addr=0x00050001') || s.includes('addr=0x00050002'));
    if (hit6) pass('T6b watch hit + last', `stop=${stop6} ${s.trim()}`);
    else fail('T6b watch hit + last', `stop=${stop6} last=${s.trim()}`);
    s = await mon(p, 'watch clear');
    if (!s.startsWith('OK')) fail('T6c watch clear', s);
    else pass('T6c watch clear', s.trim());
    await p.writeMemory(TGT, orig);
  } catch (e) {
    fail('global', e);
  } finally {
    log('Desconectando y cerrando emulador...');
    try { await conn.disconnect(true); } catch { /* noop */ }
  }

  console.log('\n============================================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length} | SKIP ${results.skipped.length}`);
  for (const f of results.failed) console.log(`  FAILED: ${f.t} - ${f.e}`);
  console.log('============================================================');
  process.exit(results.failed.length ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
