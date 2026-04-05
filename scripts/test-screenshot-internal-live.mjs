#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { WinUAEConnection } from '../dist/winuae-connection.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseReply(text) {
  const match = String(text || '').match(/OK\s+(\d+)x(\d+)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
    outputPath: match[3].trim(),
  };
}

function isPng(filepath) {
  if (!fs.existsSync(filepath)) {
    return false;
  }
  const fd = fs.openSync(filepath, 'r');
  try {
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    return header.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  } finally {
    fs.closeSync(fd);
  }
}

const config = {
  winuaePath: process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/.vscode/mcp-amiga-battery.uae',
  gdbPort: Number.parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const outputDir = path.resolve(process.env.WINUAE_OUTPUT_DIR || path.join(process.cwd(), 'test-output', 'screenshot-internal'));
const outputFile = path.join(outputDir, `internal-${Date.now()}.png`);
const outputWinPath = outputFile.replace(/\//g, '\\');

fs.mkdirSync(outputDir, { recursive: true });
const conn = new WinUAEConnection(config);

const report = {
  timestamp: new Date().toISOString(),
  config,
  outputFile,
};

try {
  await conn.connect();
  await sleep(2500);
  const protocol = conn.getProtocol();
  const hexReply = await protocol.sendMonitorCommand(`screenshot ${outputWinPath}`, 15000);
  const textReply = Buffer.from(hexReply, 'hex').toString('utf8');
  report.monitorReply = textReply;
  report.parsed = parseReply(textReply);

  if (!report.parsed) {
    throw new Error(`Unexpected screenshot reply: ${textReply}`);
  }
  if (!isPng(outputFile)) {
    throw new Error(`Output is not a valid PNG file: ${outputFile}`);
  }
  const stats = fs.statSync(outputFile);
  report.fileSize = stats.size;
  report.ok = true;
} finally {
  await conn.disconnect().catch(() => {});
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exit(1);
}
