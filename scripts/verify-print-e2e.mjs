#!/usr/bin/env node
/**
 * E2E de `winuae_print` con campos de struct via DWARF.
 *
 * Carga la demo 101, espera las secciones (REFRESH_OFFSETS tras el boot,
 * ~25s), resuelve `g_game.m_scene.m_scroll_x` con el lector DWARF y lo imprime.
 *
 * Uso: node scripts/verify-print-e2e.mjs
 * Env: WINUAE_PATH, WINUAE_CONFIG (defaults abajo).
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import { DwarfReader } from '../dist/dwarf.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', 'Amiga-Cpp');
const DEMO = '101_ehb_tile_scroll_driver';
const STAGE = path.join(ROOT, 'out', 'run', DEMO, 'dh1');
const MAP = path.join(ROOT, 'out', 'demos', DEMO, `${DEMO}.map`);
const ELF = MAP.replace(/\.map$/, '.elf');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { passed: [], failed: [] };
const pass = (t, d = '') => { results.passed.push(t); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, d = '') => { results.failed.push(t); console.log(`  [FAIL] ${t} - ${d}`); };
async function mon(p, cmd, t = 10000) { return Buffer.from(await p.sendMonitorCommand(cmd, t), 'hex').toString('utf8'); }
async function safePause(p, tries = 6) { for (let i = 0; i < tries; i++) { try { return await p.pause(); } catch { await sleep(400); } } return null; }

const WINUAE_PATH = process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin';
process.env.WINUAE_EXE = 'winuae-gdb.exe';
process.env.WINUAE_HEADLESS = '1';
process.env.WINUAE_USE_LEGACY_LAUNCH = '0'; // extension-style: escribe default.uae del config
process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '9000';

const bases = [path.join(process.env.USERPROFILE, '.cursor/extensions'), path.join(process.env.USERPROFILE, '.vscode/extensions')];
let extRoot = null, best = '';
for (const base of bases) { if (!fs.existsSync(base)) continue; for (const e of fs.readdirSync(base)) { const m = /^bartmanabyss\.amiga-debug-(.+)$/.exec(e); if (!m) continue; const c = path.join(base, e); if (!fs.existsSync(path.join(c, 'bin/win32/winuae-gdb.exe'))) continue; if (m[1] > best) { best = m[1]; extRoot = c; } } }
fs.mkdirSync(STAGE, { recursive: true });
fs.copyFileSync(path.join(ROOT, `out/demos/${DEMO}/${DEMO}.exe`), path.join(STAGE, 'a.exe'));
const dh0 = path.join(extRoot, 'bin', 'dh0');
fs.mkdirSync(path.join(dh0, 's'), { recursive: true });
fs.writeFileSync(path.join(dh0, 's/startup-sequence'), 'cd dh1:\n:a.exe\n', 'utf8');
let cfg = fs.readFileSync(path.join(ROOT, 'config', 'mcp-amiga-c-debug.uae'), 'utf8');
cfg = cfg.replace(/^filesystem=rw,dh0:.*$/m, `filesystem=rw,dh0:${dh0.replace(/\//g, '\\')}`);
cfg = cfg.replace(/^filesystem2=rw,dh1:.*$/m, `filesystem2=rw,dh1:dh1:${STAGE.replace(/\//g, '\\')},-128`);
cfg = cfg.replace(/^warp=.*$/m, 'warp=false');
fs.mkdirSync(path.join(ROOT, 'out', 'run', DEMO), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', 'run', DEMO, 'runner-cap.uae'), cfg);

const conn = new WinUAEConnection({ winuaePath: extRoot ? path.join(extRoot, 'bin', 'win32') : WINUAE_PATH, configFile: path.join(ROOT, 'out', 'run', DEMO, 'runner-cap.uae'), gdbPort: 2345 });
function mapSections(mapPath) {
  const secs = [];
  for (const raw of fs.readFileSync(mapPath, 'utf8').split(/\r?\n/g)) {
    const m = /^\.(text|rodata|data|bss)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)/.exec(raw);
    if (m && parseInt(m[3], 16) > 0) secs.push({ name: m[1], start: parseInt(m[2], 16), size: parseInt(m[3], 16) });
  }
  return secs;
}
function linkedOf(mapPath, base, dr) {
  const v = dr.findVariable(base);
  if (v) { const la = dr.variableAddress(v); if (la !== null) return la; }
  const lines = fs.readFileSync(mapPath, 'utf8').split(/\r?\n/g);
  for (let i = 0; i < lines.length; i++) {
    const sec = /^\s+\.(?:data|text|rodata|bss)\.(\S+)\s*$/.exec(lines[i]);
    if (!sec) continue;
    const a = /^\s*0x([0-9a-fA-F]+)\s+0x/.exec(lines[i + 1] ?? '');
    if (!a) continue;
    const dm = /(?:.*)(\d+)([A-Za-z_][A-Za-z0-9_]*?)E?$/.exec(sec[1]);
    if (dm && dm[2].slice(0, parseInt(dm[1], 10)) === base) return parseInt(a[1], 16);
  }
  for (const raw of lines) {
    const m = new RegExp(`^\\s*0x([0-9a-fA-F]+)\\s+${base}\\b`).exec(raw);
    if (m) return parseInt(m[1], 16);
  }
  return -1;
}
try {
  await conn.connect({ forceBreak: false, initializeStopped: true });
  await sleep(9000);
  const p = conn.getProtocol();
  await p.continue();
  // esperar secciones (REFRESH_OFFSETS tras boot ~25s)
  console.log('Esperando carga de la demo (REFRESH_OFFSETS)...');
  let bases = '';
  for (let i = 0; i < 90; i++) {
    bases = await mon(p, 'base', 2000).catch(() => '');
    if (/sec\d+=0x[0-9a-fA-F]{8}/.test(bases) && !/sec0=0x00000000/.test(bases)) break;
    await sleep(500);
  }
  const runtimeSections = [];
  for (const raw of bases.split(/\r?\n/g)) { const m = /^sec(\d+)=0x([0-9a-fA-F]+)/.exec(raw.trim()); if (m) runtimeSections[parseInt(m[1], 10)] = parseInt(m[2], 16); }
  if (!runtimeSections.length) { fail('T1 demo cargada (secciones)', 'sin secciones tras 60s'); }
  else pass('T1 demo cargada (secciones)', runtimeSections.map(x => '0x' + x.toString(16)).join(','));
  await safePause(p); await sleep(100);

  const dr = new DwarfReader(ELF);
  dr.parse();
  const secs = mapSections(MAP);

  // T2: g_game.m_scene.m_scroll_x
  const linked = linkedOf(MAP, 'g_game', dr);
  if (linked < 0) { fail('T2 g_game.m_scene.m_scroll_x', 'linked no resuelto'); }
  else {
    const idx = secs.findIndex(s => linked >= s.start && linked < s.start + s.size);
    let addr = (runtimeSections[idx] ?? runtimeSections[0]) + (linked - (idx >= 0 ? secs[idx].start : 0x400));
    let typeDie = (() => { const v = dr.findVariable('g_game'); const t = v.attrs.get(0x49); return t ? dr.resolveRef(t.value) : null; })();
    let t = dr.resolveType(typeDie);
    const sceneM = t.members.find(x => x.name === 'm_scene');
    addr += sceneM.offset;
    t = dr.resolveType(sceneM.typeDie);
    const sxM = t.members.find(x => x.name === 'm_scroll_x');
    addr += sxM.offset;
    const pr = await mon(p, `print 0x${addr.toString(16)} size=16`);
    if (/value=0x/.test(pr)) pass('T2 g_game.m_scene.m_scroll_x', `@0x${addr.toString(16)} ${pr.trim()}`);
    else fail('T2 g_game.m_scene.m_scroll_x', pr.trim());
  }

  // T3: g_game.m_ready (bool)
  {
    const linked2 = linkedOf(MAP, 'g_game', dr);
    const idx = secs.findIndex(s => linked2 >= s.start && linked2 < s.start + s.size);
    let addr = (runtimeSections[idx] ?? runtimeSections[0]) + (linked2 - (idx >= 0 ? secs[idx].start : 0x400));
    let typeDie = (() => { const v = dr.findVariable('g_game'); const t = v.attrs.get(0x49); return t ? dr.resolveRef(t.value) : null; })();
    let t = dr.resolveType(typeDie);
    const readyM = t.members.find(x => x.name === 'm_ready');
    addr += readyM.offset;
    const pr = await mon(p, `print 0x${addr.toString(16)} size=8`);
    if (/value=0x/.test(pr)) pass('T3 g_game.m_ready', pr.trim());
    else fail('T3 g_game.m_ready', pr.trim());
  }

  console.log('\n============================================');
  console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
  process.exit(results.failed.length ? 1 : 0);
} catch (e) {
  console.error('Fatal:', e.message.slice(0, 200));
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}

