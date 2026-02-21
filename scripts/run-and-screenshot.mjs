#!/usr/bin/env node
/**
 * Launch WinUAE with disk.adf, wait for boot, take PNG screenshot.
 * The same process spawns and connects - avoids CLOSE_WAIT issues.
 * Usage: node scripts/run-and-screenshot.mjs [output.png]
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const outFile = process.argv[2] || path.join(process.cwd(), 'out', 'amiga-capture.png');
const absOut = path.resolve(outFile).replace(/\//g, '\\');

const bootAdf = process.env.WINUAE_BOOT_ADF || 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/disk.adf';

const config = {
  winuaePath: process.env.WINUAE_PATH || 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/.vscode/mcp-amiga-debug.uae',
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

process.env.WINUAE_BOOT_ADF = bootAdf;
process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '12000';

console.log('Starting WinUAE with', path.basename(bootAdf), '...');
const conn = new WinUAEConnection(config);
conn.setFloppy(0, bootAdf);
await conn.connect();
console.log('Connected. Waiting 8s for boot...');
await new Promise((r) => setTimeout(r, 8000));
const protocol = conn.getProtocol();
console.log('Taking screenshot...');
await protocol.sendMonitorCommand(`screenshot ${absOut}`, 15000);
console.log('Screenshot saved:', absOut);
