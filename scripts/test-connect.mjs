#!/usr/bin/env node
/**
 * Test: spawn WinUAE, connect, take screenshot. Run from project root.
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

process.env.WINUAE_TRACE = '1';

const config = {
  winuaePath: 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/.vscode/mcp-amiga-debug.uae',
  gdbPort: 2345,
};

const bootAdf = 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/disk.adf';
process.env.WINUAE_BOOT_ADF = bootAdf;

console.log('=== Test connect + screenshot ===');
const conn = new WinUAEConnection(config);
conn.setFloppy(0, bootAdf);

try {
  await conn.connect();
  console.log('Connected! Waiting 6s for boot...');
  await new Promise((r) => setTimeout(r, 6000));
  const protocol = conn.getProtocol();
  const outPath = path.join(process.cwd(), 'out', 'test-capture.png').replace(/\//g, '\\');
  console.log('Taking screenshot:', outPath);
  await protocol.sendMonitorCommand(`screenshot ${outPath}`, 15000);
  console.log('OK - screenshot saved');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  if (conn.connected) await conn.disconnect();
}
