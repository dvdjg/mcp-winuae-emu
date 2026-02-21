#!/usr/bin/env node
/**
 * Test with extension's WinUAE (known to work)
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

process.env.WINUAE_TRACE = '1';

const config = {
  winuaePath: 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32',
  configFile: 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32/default.uae',
  gdbPort: 2345,
};

const bootAdf = 'c:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/disk.adf';
process.env.WINUAE_BOOT_ADF = bootAdf;

console.log('=== Test with extension WinUAE ===');
const conn = new WinUAEConnection(config);
conn.setFloppy(0, bootAdf);

try {
  await conn.connect();
  console.log('Connected! Taking screenshot...');
  const protocol = conn.getProtocol();
  const outPath = 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\Cursor-Amiga-C\\out\\test-capture.png';
  await protocol.sendMonitorCommand(`screenshot ${outPath}`, 15000);
  console.log('OK - screenshot saved');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  if (conn.connected) await conn.disconnect();
}
