#!/usr/bin/env node
/**
 * Test connectExisting: WinUAE must already be running (e.g. launch-winuae-for-mcp.bat)
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

process.env.WINUAE_TRACE = '1';
process.env.WINUAE_DEBUG = '1';

const config = {
  winuaePath: 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/.vscode/mcp-amiga-debug.uae',
  gdbPort: 2345,
};

console.log('=== Test connectExisting (WinUAE must be running) ===');
const conn = new WinUAEConnection(config);

try {
  await conn.connectExisting();
  console.log('Connected! Taking screenshot...');
  const protocol = conn.getProtocol();
  const outPath = path.resolve('C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/test-capture.png').replace(/\//g, '\\');
  await protocol.sendMonitorCommand(`screenshot ${outPath}`, 15000);
  console.log('OK - screenshot saved to', outPath);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
