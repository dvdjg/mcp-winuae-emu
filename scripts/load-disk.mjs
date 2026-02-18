#!/usr/bin/env node
/**
 * Load a disk image into DF0: and launch/restart WinUAE.
 * Supports ADF (Amiga Disk File), ZIP (first image inside), ADZ, DMS, IPF.
 * Usage: node scripts/load-disk.mjs <path-to-disk.adf|.zip|...>
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';

const diskPath = process.argv[2];
if (!diskPath) {
  console.error('Usage: node scripts/load-disk.mjs <path-to-disk.adf|.zip|...>');
  process.exit(1);
}

const absPath = path.resolve(diskPath);
const { existsSync } = await import('fs');
if (!existsSync(absPath)) {
  console.error(`File not found: ${absPath}`);
  process.exit(1);
}

const config = {
  winuaePath: process.env.WINUAE_PATH || 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || path.join(
    process.env.WINUAE_PATH || 'c:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
    'Configurations',
    'A500-Dev.uae'
  ),
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const conn = new WinUAEConnection(config);
try {
  const status = await conn.connectSmart();
  console.log(status);
  conn.setFloppy(0, absPath);
  const restartMsg = await conn.restart();
  console.log(`Inserted ${absPath} into DF0:\n${restartMsg}`);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
