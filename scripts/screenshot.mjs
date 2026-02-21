#!/usr/bin/env node
/**
 * Connect to existing WinUAE and take a PNG screenshot.
 * Usage: WINUAE_CONNECT_EXISTING=1 node scripts/screenshot.mjs [output.png]
 * Or: set WINUAE_CONNECT_EXISTING=1 && node scripts/screenshot.mjs
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const outFile = process.argv[2] || path.join(process.cwd(), 'winuae-capture.png');
const absOut = path.resolve(outFile).replace(/\//g, '\\');

const config = {
  winuaePath: process.env.WINUAE_PATH || 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/.vscode/mcp-amiga-debug.uae',
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

console.log('Connecting to WinUAE on port', config.gdbPort, '...');
const conn = new WinUAEConnection(config);
await conn.connectExisting();
console.log('Connected. Taking screenshot...');
const protocol = conn.getProtocol();
await protocol.sendMonitorCommand(`screenshot ${absOut}`, 15000);
console.log('Screenshot saved:', absOut);
