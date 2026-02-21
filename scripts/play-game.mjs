#!/usr/bin/env node
/**
 * Launch an Amiga game in WinUAE, wait for boot, then send joystick/keyboard
 * inputs (move + fire). Uses C:\Amiga\A500-Dev.uae and ROM from C:\Amiga.
 * Usage: node scripts/play-game.mjs <path-to-disk.zip>
 *
 * If the screen stays black: set WINUAE_USE_GUI_NO=0 so WinUAE opens its
 * window (e.g. "set WINUAE_USE_GUI_NO=0" in cmd, or $env:WINUAE_USE_GUI_NO="0" in PowerShell).
 * Ensure A500-Dev.uae has quickstart=a500,1 and kickstart_rom_file pointing to your ROM.
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const gamePath = process.argv[2] || 'c:\\Amiga\\FullSet\\J\\Jim Power in Mutant Planet_Disk1.zip';
const absPath = path.resolve(gamePath);
const { existsSync } = await import('fs');
if (!existsSync(absPath)) {
  console.error('File not found:', absPath);
  process.exit(1);
}

const config = {
  winuaePath: process.env.WINUAE_PATH || 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'C:/Amiga/A500-Dev.uae',
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const conn = new WinUAEConnection(config);
const connectExisting = process.env.WINUAE_CONNECT_EXISTING === '1';

if (!connectExisting) {
  conn.setFloppy(0, absPath);
  if (!process.env.WINUAE_GDB_INITIAL_DELAY_MS) process.env.WINUAE_GDB_INITIAL_DELAY_MS = '8000';
  console.log('Starting WinUAE with', path.basename(absPath), '...');
  await conn.connect();
  console.log('Connected. Waiting 35s for game to boot...');
  await new Promise((r) => setTimeout(r, 35000));
} else {
  console.log('Connecting to existing WinUAE on port', config.gdbPort, '...');
  await conn.connectExisting();
  console.log('Connected. Waiting 10s then sending keys...');
  await new Promise((r) => setTimeout(r, 10000));
}

const protocol = conn.getProtocol();
const send = (cmd) => protocol.sendMonitorCommand(cmd, 30000);

// Screenshot paths (host absolute; WinUAE expects backslashes)
const outDir = process.env.WINUAE_SCREENSHOT_DIR || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\WinUAE-DBG';
const beforePath = path.join(outDir, 'winuae-before.png').replace(/\//g, '\\');
const afterPath = path.join(outDir, 'winuae-after.png').replace(/\//g, '\\');

console.log('Screenshot BEFORE keys:', beforePath);
await send(`screenshot ${beforePath}`);

// Jim Power: Right (0x4E), Space (0x44) for fire
console.log('Press Right...');
await send('input key 0x4E 1');
await new Promise((r) => setTimeout(r, 400));
await send('input key 0x4E 0');
await new Promise((r) => setTimeout(r, 200));
console.log('Press Space (fire)...');
await send('input key 0x44 1');
await new Promise((r) => setTimeout(r, 250));
await send('input key 0x44 0');

console.log('Screenshot AFTER keys:', afterPath);
await send(`screenshot ${afterPath}`);
console.log('Done. Captures saved to', outDir);
