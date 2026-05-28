#!/usr/bin/env node
/**
 * Prueba paso a paso tras F5 (WinUAE ya en marcha con a.exe parado).
 * 1. En VS Code: F5 "Amiga 500 (debug)" y espera a que pare en a.exe
 * 2. node scripts/test-amiga-c-step-after-f5.mjs
 */
import { spawnSync } from 'child_process';
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const AMIGA_C = process.env.AMIGA_C_ROOT || 'C:/Users/David/Documents/Programa/Amiga/Amiga-C';
const ELF = path.join(AMIGA_C, 'out/a.elf');
const NM = process.env.M68K_NM || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-nm.exe';
const ADDR2LINE = process.env.M68K_ADDR2LINE || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-addr2line.exe';

function symAddr(name) {
  const r = spawnSync(NM, ['-n', ELF], { encoding: 'utf8' });
  const line = r.stdout.split('\n').find((l) => /\bT\s+/.test(l) && l.includes(name));
  return parseInt(line.trim().split(/\s+/)[0], 16);
}

function addr2line(pc) {
  const r = spawnSync(ADDR2LINE, ['-e', ELF, '-f', '-C', `0x${pc.toString(16)}`], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  return lines.length >= 2 ? `${lines[0]}:${lines[1]}` : r.stdout.trim();
}

const conn = new WinUAEConnection({
  winuaePath: process.env.WINUAE_PATH || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32',
  configFile: '',
  gdbPort: 2345,
});

console.log('[test] Connecting to running WinUAE (after F5)...');
await conn.connectExisting({ initializeStopped: true, forceBreak: false });
const protocol = conn.getProtocol();
const takeSystem = symAddr('TakeSystem');
console.log(`[test] TakeSystem ELF $${takeSystem.toString(16)}`);
await protocol.getOffsets();
await protocol.setBreakpoint(takeSystem);
await protocol.continue();
const stop = await protocol.waitForStop(30000);
const regs = await protocol.readRegisters();
console.log(`[test] Stop ${stop} PC=$${regs.PC.toString(16)} ${addr2line(regs.PC)}`);
let last = regs.PC;
let ok = 0;
for (let i = 0; i < 5; i++) {
  await protocol.step();
  const r = await protocol.readRegisters();
  if (r.PC !== last) {
    ok++;
    console.log(`[test] step ${i + 1}: $${r.PC.toString(16)} ${addr2line(r.PC)}`);
    last = r.PC;
  }
}
await protocol.clearBreakpoint(takeSystem);
await conn.disconnect(false);
if (ok < 2) {
  console.error('FAIL: step did not advance PC');
  process.exit(1);
}
console.log('PASS: stepping OK');
