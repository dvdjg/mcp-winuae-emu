#!/usr/bin/env node
/**
 * Prueba depuración Amiga-C (main.c) vía WinUAE-DBG + protocolo MCP.
 * Uso: node scripts/test-amiga-c-step-debug.mjs
 */
import { spawnSync } from 'child_process';
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as fs from 'fs';
import * as path from 'path';

const AMIGA_C = process.env.AMIGA_C_ROOT || 'C:/Users/David/Documents/Programa/Amiga/Amiga-C';
const WINUAE_BIN = process.env.WINUAE_PATH || 'C:/Users/David/Documents/Programa/Amiga/WinUAE-DBG/bin';
const WINUAE_CONFIG = process.env.WINUAE_CONFIG || path.join(AMIGA_C, 'config/mcp-amiga-c-debug.uae');
const GDB_PORT = parseInt(process.env.WINUAE_GDB_PORT || '2345', 10);
const ELF = path.join(AMIGA_C, 'out/a.elf');
const NM = process.env.M68K_NM || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-nm.exe';
const ADDR2LINE = process.env.M68K_ADDR2LINE || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32/opt/bin/m68k-amiga-elf-addr2line.exe';

function symAddr(name) {
  const r = spawnSync(NM, ['-n', ELF], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`nm failed: ${r.stderr}`);
  const line = r.stdout.split('\n').find((l) => /\bT\s+/.test(l) && l.includes(name));
  if (!line) throw new Error(`symbol ${name} not found in nm output`);
  return parseInt(line.trim().split(/\s+/)[0], 16);
}

function addr2line(pc) {
  const r = spawnSync(ADDR2LINE, ['-e', ELF, '-f', '-C', `0x${pc.toString(16)}`], { encoding: 'utf8' });
  if (r.status !== 0) return `? (addr2line failed)`;
  const lines = r.stdout.trim().split('\n');
  return lines.length >= 2 ? `${lines[0]}:${lines[1]}` : r.stdout.trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  console.log(`[test] ${msg}`);
}

async function waitForAexe(protocol, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stop = await protocol.waitForStop(Math.min(5000, deadline - Date.now()));
      return stop;
    } catch {
      const hex = await protocol.sendMonitorCommand('findproc a.exe', 8000);
      const text = Buffer.from(hex, 'hex').toString('utf8');
      if (text.includes('a.exe') && !text.includes('not found')) {
        log('findproc: a.exe loaded');
        return 'findproc';
      }
      await sleep(500);
    }
  }
  throw new Error('Timed out waiting for a.exe');
}

async function main() {
  if (!fs.existsSync(ELF)) throw new Error(`Missing ${ELF} — run make debug in Amiga-C`);
  if (!fs.existsSync(WINUAE_CONFIG)) throw new Error(`Missing config ${WINUAE_CONFIG}`);
  if (!fs.existsSync(path.join(WINUAE_BIN, 'winuae-gdb.exe'))) {
    throw new Error(`Missing ${path.join(WINUAE_BIN, 'winuae-gdb.exe')} — build WinUAE-DBG first`);
  }

  const takeSystemElf = symAddr('TakeSystem');
  log(`ELF TakeSystem = $${takeSystemElf.toString(16)}`);

  const conn = new WinUAEConnection({
    winuaePath: WINUAE_BIN,
    configFile: WINUAE_CONFIG,
    gdbPort: GDB_PORT,
  });

  process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '1500';
  process.env.WINUAE_CWD = process.env.WINUAE_CWD
    || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32';

  log('Connecting (extension-style -portable launch)...');
  await conn.connect({ initializeStopped: true, forceBreak: false });
  const protocol = conn.getProtocol();

  log('Waiting for :a.exe (debugging_trigger)...');
  const stopReply = await waitForAexe(protocol, 90000);
  log(`Program stop: ${stopReply}`);

  let regs = await protocol.readRegisters();
  log(`PC=$${regs.PC.toString(16)} ${addr2line(regs.PC)}`);

  const qoff = await protocol.getOffsets();
  log(`qOffsets: ${qoff}`);

  const findprocHex = await protocol.sendMonitorCommand('findproc a.exe', 15000);
  log(Buffer.from(findprocHex, 'hex').toString('utf8').slice(0, 400));

  log(`Breakpoint TakeSystem @ ELF $${takeSystemElf.toString(16)}`);
  await protocol.setBreakpoint(takeSystemElf);

  log('Continue until TakeSystem...');
  await protocol.continue();
  let bpStop;
  try {
    bpStop = await protocol.waitForStop(60000);
  } catch (e) {
    await conn.disconnect(true);
    throw new Error(`Breakpoint not hit: ${e.message}`);
  }
  regs = await protocol.readRegisters();
  log(`Hit: ${bpStop} PC=$${regs.PC.toString(16)} ${addr2line(regs.PC)}`);

  let lastPc = regs.PC;
  let stepped = 0;
  for (let i = 0; i < 5; i++) {
    await protocol.step();
    regs = await protocol.readRegisters();
    if (regs.PC === lastPc) {
      log(`WARN step ${i + 1}: PC unchanged ($${regs.PC.toString(16)})`);
    } else {
      stepped++;
      log(`step ${i + 1}: PC=$${regs.PC.toString(16)} ${addr2line(regs.PC)}`);
      lastPc = regs.PC;
    }
  }

  await protocol.clearBreakpoint(takeSystemElf);
  await conn.disconnect(true);

  if (stepped < 2) {
    console.error('\nFAIL: single-step did not advance PC (rebuild WinUAE-DBG with vCont;s fix)');
    process.exit(1);
  }
  log('\nPASS: a.exe stopped, TakeSystem BP hit, instruction step advances PC');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
