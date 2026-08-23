#!/usr/bin/env node
// MCP stdio client test: verifica el dispatch de los tools de monitor v2.1.
// Lanza WinUAE directamente (ruta verificada) y el MCP se conecta con connect_existing.
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WinUAEConnection } from '../dist/winuae-connection.js';

const WINUAE_PATH = process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin';
const WINUAE_CONFIG = process.env.WINUAE_CONFIG || 'C:/Users/dvdjg/AppData/Local/Temp/opencode/a500-headless.uae';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Lanza WinUAE directamente
process.env.WINUAE_EXE = 'winuae-gdb.exe';
process.env.WINUAE_HEADLESS = '1';
process.env.WINUAE_USE_LEGACY_LAUNCH = '1';
process.env.WINUAE_GDB_INITIAL_DELAY_MS = '7000';
process.env.WINUAE_GDB_PERSIST_LISTENER = '1';
const launcher = new WinUAEConnection({ winuaePath: WINUAE_PATH, configFile: WINUAE_CONFIG, gdbPort: 2345 });
await launcher.connect();
await sleep(6000);
console.log('[launch] WinUAE up and connected');
await launcher.disconnect(false); // deja el emulador corriendo con el listener GDB abierto
await sleep(1000);
console.log('[launch] launcher detached, emulador sigue vivo');

// 2) Arranca el MCP server y conéctate
const env = {
  ...process.env,
  WINUAE_PATH,
  WINUAE_CONFIG,
  WINUAE_HEADLESS: '1',
  WINUAE_USE_LEGACY_LAUNCH: '1',
};
const transport = new StdioClientTransport({
  command: 'node',
  args: ['C:/Users/dvdjg/Documents/programa/AI/Amiga/mcp-winuae-emu/dist/index.js'],
  env,
});
const client = new Client({ name: 'verify-monitor-ext-mcp', version: '1.0.0' });

async function callTool(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return res.content?.map((c) => c.text || '').join('\n') || '';
}

try {
  await client.connect(transport);
  console.log('[mcp] connected');

  console.log('\n== winuae_connect_existing ==');
  const ce = await callTool('winuae_connect_existing', { force_break: false, initialize_stopped: false });
  console.log(ce.slice(0, 300));
  await sleep(1500);

  const check = (cond, label, detail) => {
    if (cond) { console.log(`  [PASS] ${label}`); }
    else { console.log(`  [FAIL] ${label} - ${detail}`); process.exitCode = 1; }
  };

  console.log('\n== winuae_emulator_status ==');
  const status = await callTool('winuae_emulator_status');
  console.log(status.slice(0, 400));
  check(status.includes('"cycles"') && status.includes('"frame"'), 'winuae_emulator_status', status);

  console.log('\n== winuae_watchpoint_set_ext ==');
  const wp = await callTool('winuae_watchpoint_set_ext', { address: '0x1000', access: 'w', size: 32, source: 'cpudw' });
  console.log(wp);
  check(/OK watch \[\d+\]/.test(wp), 'winuae_watchpoint_set_ext', wp);

  console.log('\n== winuae_watchpoint_list ==');
  const wl = await callTool('winuae_watchpoint_list');
  console.log(wl.slice(0, 300));
  check(wl.includes('0x00001000'), 'winuae_watchpoint_list', wl);

  console.log('\n== winuae_watchpoint_clear_ext ==');
  console.log(await callTool('winuae_watchpoint_clear_ext', { all: true }));

  console.log('\n== winuae_protect ==');
  const pb = await callTool('winuae_protect', { action: 'block', address: '0x50000', size: 16, source: 'cpudw' });
  console.log(pb);
  check(/OK protect \[\d+\]/.test(pb), 'winuae_protect block', pb);
  console.log(await callTool('winuae_protect', { action: 'clear' }));

  console.log('\n== winuae_rewind ==');
  const rw = await callTool('winuae_rewind');
  console.log(rw);
  check(rw.startsWith('OK rewind') || rw.startsWith('E01'), 'winuae_rewind', rw);

  console.log('\n== winuae_trace ==');
  const trStatus = await callTool('winuae_trace', { action: 'status' });
  console.log(trStatus);
  check(trStatus.includes('trace='), 'winuae_trace status', trStatus);
  const trOff = await callTool('winuae_trace', { action: 'off' });
  console.log(trOff);
  check(trOff.startsWith('OK trace'), 'winuae_trace off', trOff);
  const trOn = await callTool('winuae_trace', { action: 'on' });
  console.log(trOn);
  check(trOn.startsWith('OK trace'), 'winuae_trace on', trOn);

  console.log('\n== winuae_side_read ==');
  const sr1 = await callTool('winuae_side_read', { command: 'state' });
  console.log(sr1.slice(0, 160));
  check(sr1.includes('"gdbConnected"'), 'winuae_side_read state', sr1);
  const sr2 = await callTool('winuae_side_read', { command: 'mem dff180 4' });
  console.log(sr2.slice(0, 160));
  check(sr2.includes('"data"'), 'winuae_side_read mem', sr2);
  const sr3 = await callTool('winuae_side_read', { command: 'regs' });
  console.log(sr3.slice(0, 160));
  check(sr3.includes('"d0"'), 'winuae_side_read regs', sr3);

  console.log('\n== winuae_debugperiph ==');
  const dp = await callTool('winuae_debugperiph');
  console.log(dp.slice(0, 160));
  check(dp.includes('mapped=1'), 'winuae_debugperiph status', dp);
  const dpArg = await callTool('winuae_debugperiph', { command: 'arg 1 0xbeef' });
  console.log(dpArg);
  check(dpArg.startsWith('OK debug arg'), 'winuae_debugperiph arg', dpArg);
  const dpCyc = await callTool('winuae_side_read', { command: 'mem b7e928 4' });
  console.log(dpCyc.slice(0, 120));
  check(dpCyc.includes('"data"'), 'winuae_debugperiph ciclo (0xB7E928)', dpCyc);

  console.log('\n== winuae_disconnect ==');
  try { console.log((await callTool('winuae_disconnect', { stop_emulator: false })).slice(0, 200)); } catch (e) { console.log('disconnect:', e.message); }

  console.log('\nRESULTADO MCP TOOLS:', process.exitCode ? 'CON FALLOS' : 'TODOS PASS');
  process.exit(process.exitCode || 0);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  try { await launcher.disconnect(true); } catch {}
}
