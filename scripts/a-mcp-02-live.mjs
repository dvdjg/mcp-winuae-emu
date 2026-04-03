#!/usr/bin/env node
/**
 * Live validation for A-MCP-02 through the actual MCP tool handler.
 *
 * It connects to an existing WinUAE session, calls winuae_machine_snapshot,
 * stores the raw snapshot JSON, and writes a compact validation summary.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const amigaRoot = path.resolve(repoRoot, '..', 'Cursor-Amiga-C');
const outDir = path.join(amigaRoot, 'out');

const snapshotPath = path.join(outDir, 'a-mcp-02-live-machine-snapshot.json');
const summaryPath = path.join(outDir, 'a-mcp-02-live-validation-summary.json');

fs.mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  WINUAE_PATH: process.env.WINUAE_PATH || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\WinUAE-DBG\\bin',
  WINUAE_CONFIG: process.env.WINUAE_CONFIG || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\Cursor-Amiga-C\\.vscode\\mcp-amiga-debug.uae',
  WINUAE_GDB_PORT: process.env.WINUAE_GDB_PORT || '2345',
};

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  cwd: repoRoot,
  env,
  stderr: 'pipe',
});

const client = new Client({
  name: 'a-mcp-02-live-validator',
  version: '1.0.0',
});

function getText(result) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

function isToolErrorText(text) {
  return typeof text === 'string' && text.trim().startsWith('Error:');
}

const summary = {
  timestamp: new Date().toISOString(),
  snapshotPath,
  checks: {},
  notes: [],
};

let stderrLog = '';
transport.stderr?.on('data', (chunk) => {
  stderrLog += chunk.toString();
});

try {
  await client.connect(transport);

  const connectResult = await client.callTool({
    name: 'winuae_connect_existing',
    arguments: {},
  });
  summary.connectExisting = getText(connectResult);
  summary.connectionMode = 'connect_existing';

  if (isToolErrorText(summary.connectExisting)) {
    const managedConnectResult = await client.callTool({
      name: 'winuae_connect',
      arguments: {},
    });
    summary.connect = getText(managedConnectResult);
    summary.connectionMode = 'connect';
    if (isToolErrorText(summary.connect)) {
      throw new Error(`Unable to establish WinUAE session. existing=${summary.connectExisting} managed=${summary.connect}`);
    }
  }

  const snapshotResult = await client.callTool({
    name: 'winuae_machine_snapshot',
    arguments: {
      include_cpu: true,
      include_custom: true,
      chip_ram_address: '$000000',
      chip_ram_bytes: 0x5000,
      fast_ram_address: '$00200000',
      fast_ram_bytes: 0x40,
    },
  });

  const snapshotText = getText(snapshotResult);
  if (isToolErrorText(snapshotText)) {
    throw new Error(snapshotText);
  }
  fs.writeFileSync(snapshotPath, snapshotText, 'utf8');

  const snapshot = JSON.parse(snapshotText);
  const customRegisters = snapshot?.custom?.registers ?? {};
  const chip = snapshot?.memory?.chip;
  const fast = snapshot?.memory?.fast;

  summary.checks.cpu_present = Boolean(snapshot?.cpu?.PC && snapshot?.cpu?.A7);
  summary.checks.custom_present = Boolean(snapshot?.custom?.bytes_read === 0x200);
  summary.checks.custom_register_count = Object.keys(customRegisters).length;
  summary.checks.custom_key_registers = {
    DMACON: customRegisters.DMACON?.value ?? null,
    BPLCON0: customRegisters.BPLCON0?.value ?? null,
    COLOR00: customRegisters.COLOR00?.value ?? null,
  };
  summary.checks.chip_window = chip ?? null;
  summary.checks.chip_truncation_ok = Boolean(
    chip &&
    chip.requested_bytes === 0x5000 &&
    chip.bytes_read === 0x4000 &&
    chip.truncated === true
  );
  summary.checks.fast_window = fast ?? null;
  summary.checks.fast_region_handled = Boolean(
    fast && (typeof fast.data_hex === 'string' || typeof fast.error === 'string')
  );

  if (!summary.checks.cpu_present) {
    summary.notes.push('CPU snapshot missing expected PC/A7 fields.');
  }
  if (!summary.checks.custom_present) {
    summary.notes.push('Custom register block did not report the expected 0x200 bytes.');
  }
  if (!summary.checks.chip_truncation_ok) {
    summary.notes.push('Chip RAM window did not enforce the expected 16 KiB cap.');
  }
  if (!summary.checks.fast_region_handled) {
    summary.notes.push('Fast RAM window did not return either data or a region-specific error.');
  }

  const disconnectResult = await client.callTool({
    name: 'winuae_disconnect',
    arguments: {
      stop_emulator: summary.connectionMode === 'connect',
    },
  });
  summary.disconnect = getText(disconnectResult);
} finally {
  summary.stderrTail = stderrLog.slice(-4000);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
}

console.log(JSON.stringify(summary, null, 2));
