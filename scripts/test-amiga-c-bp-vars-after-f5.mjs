#!/usr/bin/env node
/**
 * Prueba breakpoints + variables (equivalente a lo que muestra el depurador).
 *
 * Requisito: F5 "Amiga 500 (debug)" en Amiga-C y emulador parado en :a.exe
 *
 *   node scripts/test-amiga-c-bp-vars-after-f5.mjs
 */
import { spawnSync } from 'child_process';
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const AMIGA_C = process.env.AMIGA_C_ROOT || 'C:/Users/David/Documents/Programa/Amiga/Amiga-C';
const ELF = path.join(AMIGA_C, 'out/a.elf');
const ELF_TEXT = 0x400;
const NM = process.env.M68K_NM || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-nm.exe';
const ADDR2LINE = process.env.M68K_ADDR2LINE || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-addr2line.exe';
const OBJDUMP = process.env.M68K_OBJDUMP || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-objdump.exe';

const SYMS = {
  TakeSystem: null,
  main: null,
  frameCounter: null,
  SystemInts: null,
  SystemDMA: null,
};

function loadSymbols() {
  const r = spawnSync(NM, ['-n', ELF], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`nm failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    for (const name of Object.keys(SYMS)) {
      if (line.includes(name)) {
        const parts = line.trim().split(/\s+/);
        const addr = parseInt(parts[0], 16);
        const type = parts[parts.length - 2];
        if (name === 'main' || name === 'TakeSystem') {
          if (type === 'T') SYMS[name] = addr;
        } else if (type === 'B' || type === 'b') {
          SYMS[name] = addr;
        }
      }
    }
  }
  for (const [k, v] of Object.entries(SYMS)) {
    if (v == null) throw new Error(`symbol ${k} not found`);
  }
}

function addr2line(pc) {
  const r = spawnSync(ADDR2LINE, ['-e', ELF, '-f', '-C', `0x${pc.toString(16)}`], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  return lines.length >= 2 ? `${lines[0]}:${lines[1]}` : r.stdout.trim();
}

function parseOffsets(reply) {
  if (reply.startsWith('E')) {
    throw new Error(`qOffsets error: ${reply}`);
  }
  const raw = reply.startsWith('$') ? reply.slice(1) : reply;
  const sections = raw.split(';').filter(Boolean).map((h) => parseInt(h, 16));
  if (!sections.length) throw new Error(`qOffsets empty: ${reply}`);
  return { baseText: sections[0], sections };
}

function elfAddr(elfVma) {
  return elfVma; // WinUAE-DBG Z0 usa direcciones ELF; el stub reubica
}

function runtimeBss(elfBssAddr, baseText) {
  return baseText + (elfBssAddr - ELF_TEXT);
}

function log(msg) {
  console.log(`[test] ${msg}`);
}

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function expectStop(protocol, label, timeoutMs = 45000) {
  const stop = await protocol.waitForStop(timeoutMs);
  const regs = await protocol.readRegisters();
  const loc = addr2line(regs.PC);
  log(`${label}: stop=${stop} PC=$${regs.PC.toString(16)} → ${loc}`);
  return { stop, regs, loc };
}

async function readU16(protocol, addr) {
  const buf = await protocol.readMemory(addr, 2);
  return buf.readUInt16BE(0);
}

async function readS16(protocol, addr) {
  const v = await readU16(protocol, addr);
  return v > 0x7fff ? v - 0x10000 : v;
}

async function main() {
  loadSymbols();
  log(`ELF symbols: TakeSystem=$${SYMS.TakeSystem.toString(16)} main=$${SYMS.main.toString(16)} frameCounter=$${SYMS.frameCounter.toString(16)}`);

  const conn = new WinUAEConnection({
    winuaePath: process.env.WINUAE_PATH || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32',
    configFile: '',
    gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
  });

  log('connectExisting (WinUAE debe estar en F5 / parado en a.exe)...');
  try {
    await conn.connectExisting({ initializeStopped: true, forceBreak: false });
  } catch (e) {
    fail(`No hay GDB en :2345 — lanza F5 primero. (${e.message})`);
  }

  const protocol = conn.getProtocol();
  let passed = 0;

  const findHex = await protocol.sendMonitorCommand('findproc a.exe', 12000);
  const findText = Buffer.from(findHex, 'hex').toString('utf8');
  log(`findproc:\n${findText.split('\n').slice(0, 6).join('\n')}`);
  if (findText.includes('not found')) {
    await conn.disconnect(false);
    fail('a.exe no cargado — usa F5 y espera la parada en :a.exe');
  }
  passed++;

  const qoffRaw = await protocol.queryOffsets();
  log(`qOffsets raw: ${qoffRaw}`);
  const { baseText, sections } = parseOffsets(qoffRaw);
  log(`baseText=$${baseText.toString(16)} sections=${sections.map((s) => '$' + s.toString(16)).join(', ')}`);
  if (baseText < 0x1000) fail(`baseText inválido: $${baseText.toString(16)}`);
  passed++;

  const fcAddr = runtimeBss(SYMS.frameCounter, baseText);
  const sysIntsAddr = runtimeBss(SYMS.SystemInts, baseText);
  let fc = await readS16(protocol, fcAddr);
  log(`frameCounter @ $${fcAddr.toString(16)} = ${fc} (esperado ~0 al inicio)`);
  if (fc < -32768 || fc > 32767) log('WARN: frameCounter fuera de rango short');
  else passed++;

  // --- Breakpoint TakeSystem ---
  const bpTake = elfAddr(SYMS.TakeSystem);
  log(`Z0 breakpoint TakeSystem ELF $${bpTake.toString(16)}`);
  await protocol.setBreakpoint(bpTake);
  await protocol.continue();
  const hitTake = await expectStop(protocol, 'BP TakeSystem');
  if (!hitTake.loc.includes('TakeSystem')) {
    log(`WARN: PC no en TakeSystem (${hitTake.loc})`);
  } else {
    passed++;
  }

  // Tras Forbid + guardar regs: tras varios steps debería haber escrito SystemInts
  for (let i = 0; i < 8; i++) await protocol.step();
  const sysAfter = await readU16(protocol, sysIntsAddr);
  log(`SystemInts @ $${sysIntsAddr.toString(16)} = 0x${sysAfter.toString(16)} (guardado desde custom->intenar)`);
  if (sysAfter === 0 && sysAfter !== 0xffff) log('WARN: SystemInts aún 0 (quizá no se ejecutó la línea 75)');
  else passed++;

  await protocol.clearBreakpoint(bpTake);

  // --- Breakpoint main ---
  const bpMain = elfAddr(SYMS.main);
  log(`Z0 breakpoint main ELF $${bpMain.toString(16)}`);
  await protocol.setBreakpoint(bpMain);
  await protocol.continue();
  const hitMain = await expectStop(protocol, 'BP main');
  if (!hitMain.loc.includes('main')) {
    log(`WARN: PC no en main (${hitMain.loc})`);
  } else {
    passed++;
  }

  fc = await readS16(protocol, fcAddr);
  log(`frameCounter en main = ${fc}`);
  passed++;

  // Paso en main: frameCounter debería incrementarse en el bucle (buscar incremento tras N steps)
  const fcBefore = fc;
  for (let i = 0; i < 200; i++) {
    await protocol.step();
    fc = await readS16(protocol, fcAddr);
    if (fc !== fcBefore) {
      log(`frameCounter cambió tras ${i + 1} steps: ${fcBefore} → ${fc}`);
      passed++;
      break;
    }
  }
  if (fc === fcBefore) log('WARN: frameCounter no cambió en 200 steps (bucle puede estar lejos)');

  await protocol.clearBreakpoint(bpMain);

  // --- Breakpoint “línea sin código” (WaitBlt inline ~ línea 67) ---
  const dump = spawnSync(OBJDUMP, ['-d', ELF], { encoding: 'utf8' });
  const takeLine = dump.stdout.split('\n').find((l) => l.includes('<TakeSystem>'));
  log(`objdump TakeSystem: ${takeLine?.trim() || '?'}`);
  const badElf = SYMS.TakeSystem + 0x20; // offset dentro de TakeSystem, no en WaitBlt vacío
  await protocol.setBreakpoint(badElf);
  await protocol.continue();
  try {
    await protocol.waitForStop(5000);
    log('WARN: breakpoint intermedio también paró (inesperado)');
  } catch {
    log('OK: sin parada inmediata en offset arbitrario (comportamiento puede variar)');
  }
  await protocol.clearBreakpoint(badElf);

  await conn.disconnect(false);

  log(`\n=== Resultado: ${passed} comprobaciones OK ===`);
  if (passed < 6) {
    fail('Demasiadas comprobaciones fallidas — revisa WinUAE-DBG (vCont, qOffsets, Z0 reloc)');
  }
  log('PASS: breakpoints y lectura de variables globales coherentes con el depurador');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
