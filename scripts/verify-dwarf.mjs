#!/usr/bin/env node
/**
 * Verificacion OFFLINE del lector DWARF: resuelve miembros de structs desde el
 * .elf de la demo 101 sin necesidad de emulador (determinista y rapido).
 *
 * Uso: node scripts/verify-dwarf.mjs [demos/101_ehb_tile_scroll_driver]
 * Requiere la demo compilada (out/demos/<demo>/<demo>.elf).
 */
import { DwarfReader } from '../dist/dwarf.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', 'Amiga-Cpp');
const DEMO_ARG = process.argv[2] || 'demos/101_ehb_tile_scroll_driver';
const DEMO = DEMO_ARG.replace(/^demos\//, '');
const ELF = path.join(ROOT, 'out', 'demos', DEMO, `${DEMO}.elf`);

const results = { passed: [], failed: [] };
const pass = (t, d = '') => { results.passed.push(t); console.log(`  [PASS] ${t}${d ? ` - ${d}` : ''}`); };
const fail = (t, d = '') => { results.failed.push(t); console.log(`  [FAIL] ${t} - ${d}`); };

if (!fs.existsSync(ELF)) {
  console.error(`No existe ${ELF}. Compila la demo.`);
  process.exit(1);
}

const dr = new DwarfReader(ELF);
dr.parse();

// T1: variable global g_game con tipo struct DemoGame
const g = dr.findVariable('g_game');
if (g) {
  const t = g.attrs.get(0x49);
  const dt = dr.resolveType(t ? dr.resolveRef(t.value) : null);
  if (dt.kind === 'struct' && dt.size > 1000 && dt.members.length > 5)
    pass('T1 g_game -> DemoGame struct', `kind=${dt.kind} size=${dt.size} miembros=${dt.members.length}`);
  else fail('T1 g_game -> DemoGame struct', `kind=${dt.kind} size=${dt.size} miembros=${dt.members.length}`);

  // T2: offsets de miembros conocidos
  const ready = dt.members.find(m => m.name === 'm_ready');
  const scene = dt.members.find(m => m.name === 'm_scene');
  if (ready && ready.offset === 0 && scene && scene.offset === 2)
    pass('T2 m_ready@0 y m_scene@2', `m_ready@${ready.offset} m_scene@${scene.offset}`);
  else fail('T2 m_ready@0 y m_scene@2', `m_ready@${ready?.offset} m_scene@${scene?.offset}`);

  // T3: m_scene.m_scroll_x (estructura anidada)
  if (scene) {
    const st = dr.resolveType(scene.typeDie);
    const sx = st.members.find(m => m.name === 'm_scroll_x');
    const bp = st.members.find(m => m.name === 'm_bitplane_block');
    if (sx && sx.offset === 60 && bp && bp.offset === 14)
      pass('T3 m_scene.m_scroll_x@60 y m_bitplane_block@14', `m_scroll_x@${sx.offset} m_bitplane_block@${bp.offset}`);
    else fail('T3 m_scene.m_scroll_x@60 y m_bitplane_block@14', `m_scroll_x@${sx?.offset} m_bitplane_block@${bp?.offset}`);
  }
} else {
  fail('T1 g_game -> DemoGame struct', 'g_game no encontrado');
}

// T4: RunStatus (tipo) - miembros del struct de estado
const rtDie = dr.findType('RunStatus') || dr.findType('_ZN3eng5debug9RunStatusE');
if (rtDie) {
  const rt = dr.resolveType(rtDie);
  const names = rt.members.map(m => m.name);
  if (rt.kind === 'struct' && names.includes('magic') && names.includes('state') && names.includes('frame'))
    pass('T4 RunStatus struct', `size=${rt.size} miembros=${names.join(',')}`);
  else fail('T4 RunStatus struct', `kind=${rt.kind} size=${rt.size} miembros=${names.join(',')}`);
} else {
  fail('T4 RunStatus struct', 'tipo RunStatus no encontrado');
}

console.log('\n============================================');
console.log(`RESULTADO: PASS ${results.passed.length} | FAIL ${results.failed.length}`);
process.exit(results.failed.length ? 1 : 0);
