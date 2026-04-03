#!/usr/bin/env node
/**
 * Reproducible A-MCP-01 validation matrix.
 *
 * What it covers:
 * - connect() with per-drive floppy assignment and restart()
 * - connectExisting() against a running WinUAE instance
 * - hot-swap insert/eject monitor commands for DF0:..DF3:
 *
 * Output:
 * - test-output/a-mcp-01-matrix/report.json
 * - test-output/a-mcp-01-matrix/report.md
 */

import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST_ENTRY = path.join(ROOT, 'dist', 'winuae-connection.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function checkPort(port) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.once('connect', () => {
      sock.end();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1200, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function formatStatusTable(rows) {
  const headers = ['Phase', 'Drive', 'Mode', 'Operation', 'Status', 'Detail'];
  const widths = headers.map(h => h.length);
  for (const row of rows) {
    widths[0] = Math.max(widths[0], row.phase.length);
    widths[1] = Math.max(widths[1], String(row.drive).length);
    widths[2] = Math.max(widths[2], row.mode.length);
    widths[3] = Math.max(widths[3], row.operation.length);
    widths[4] = Math.max(widths[4], row.status.length);
    widths[5] = Math.max(widths[5], row.detail.length);
  }

  const pad = (value, width) => String(value).padEnd(width, ' ');
  const lines = [];
  lines.push(`| ${headers.map((h, i) => pad(h, widths[i])).join(' | ')} |`);
  lines.push(`| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`);
  for (const row of rows) {
    lines.push(
      `| ${pad(row.phase, widths[0])} | ${pad(row.drive, widths[1])} | ${pad(row.mode, widths[2])} | ` +
      `${pad(row.operation, widths[3])} | ${pad(row.status, widths[4])} | ${pad(row.detail, widths[5])} |`
    );
  }
  return lines.join('\n');
}

function normalizePathForMonitor(absPath) {
  return absPath.replace(/"/g, '\\"');
}

function defaultConfig() {
  return {
    winuaePath: process.env.WINUAE_PATH || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\WinUAE-DBG\\bin',
    configFile: process.env.WINUAE_CONFIG || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\Cursor-Amiga-C\\.vscode\\mcp-amiga-debug.uae',
    gdbPort: toInt(process.env.WINUAE_GDB_PORT, 2345),
  };
}

function defaultPaths() {
  const adf = process.env.A_MCP_01_ADF || 'C:\\Users\\dvdjg\\Documents\\programa\\AI\\Cursor-Amiga-C\\out\\disk.adf';
  const bootAdf = process.env.A_MCP_01_BOOT_ADF || adf;
  const outDir = process.env.A_MCP_01_OUT_DIR || path.join(ROOT, 'test-output', 'a-mcp-01-matrix');
  return {
    adf: path.resolve(adf),
    bootAdf: path.resolve(bootAdf),
    outDir: path.resolve(outDir),
  };
}

async function importConnection() {
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`Missing build output: ${DIST_ENTRY}. Run npm run build first.`);
  }
  return import('../dist/winuae-connection.js');
}

async function launchWithDrive(WinUAEConnection, config, drive, mountedAdf, bootAdf, waitMs) {
  const conn = new WinUAEConnection(config);
  conn.setSessionIdlePolicy(0, 'detach');
  if (drive !== 0 && bootAdf) {
    conn.setFloppy(0, bootAdf);
  }
  conn.setFloppy(drive, mountedAdf);

  const result = {
    startedAt: new Date().toISOString(),
    connected: false,
    connectStatus: 'FAIL',
    restartStatus: 'SKIP',
    pcBefore: null,
    pcAfter: null,
    sessionInfoBefore: null,
    sessionInfoAfter: null,
    floppiesBefore: [],
    floppiesAfter: [],
    error: '',
  };

  try {
    await conn.connect();
    result.connected = true;
    result.connectStatus = 'PASS';
    await sleep(waitMs);

    const protocol = conn.getProtocol();
    const regs = await protocol.readRegisters();
    result.pcBefore = `0x${regs.PC.toString(16).toUpperCase().padStart(8, '0')}`;
    result.sessionInfoBefore = conn.getSessionInfo();
    result.floppiesBefore = Array.from(conn.getFloppies().entries());

    try {
      await conn.restart();
      result.restartStatus = 'PASS';
      await sleep(waitMs);

      const regsAfter = await conn.getProtocol().readRegisters();
      result.pcAfter = `0x${regsAfter.PC.toString(16).toUpperCase().padStart(8, '0')}`;
      result.sessionInfoAfter = conn.getSessionInfo();
      result.floppiesAfter = Array.from(conn.getFloppies().entries());
    } catch (err) {
      result.restartStatus = 'FAIL';
      result.error = err instanceof Error ? err.message : String(err);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (conn.connected) {
      try {
        await conn.disconnect(true);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  return result;
}

async function runExistingHotSwap(WinUAEConnection, config, mountedAdf, drives, waitMs, launchedSeed) {
  const seedConn = new WinUAEConnection(config);
  seedConn.setSessionIdlePolicy(0, 'detach');
  const rows = [];
  const result = {
    connected: false,
    health: false,
    sessionInfo: null,
    rows,
    error: '',
  };

  try {
    if (launchedSeed) {
      seedConn.setFloppy(0, mountedAdf);
      await seedConn.connect();
      await sleep(waitMs);
      await seedConn.disconnect(false);
    }

    const attached = new WinUAEConnection(config);
    attached.setSessionIdlePolicy(0, 'detach');
    await attached.connectExisting();
    result.connected = true;
    await sleep(waitMs);

    const protocol = attached.getProtocol();
    for (const drive of drives) {
      const quotedPath = normalizePathForMonitor(mountedAdf);
      try {
        await protocol.sendMonitorCommand(`df${drive} insert "${quotedPath}"`, 15000);
        rows.push({
          drive,
          operation: 'insert',
          status: 'PASS',
          detail: `df${drive} insert accepted`,
        });
      } catch (err) {
        rows.push({
          drive,
          operation: 'insert',
          status: 'FAIL',
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      try {
        await protocol.sendMonitorCommand(`df${drive} eject`, 15000);
        rows.push({
          drive,
          operation: 'eject',
          status: 'PASS',
          detail: `df${drive} eject accepted`,
        });
      } catch (err) {
        rows.push({
          drive,
          operation: 'eject',
          status: 'FAIL',
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      await sleep(Math.max(250, Math.floor(waitMs / 2)));
    }

    result.health = await attached.healthCheck();
    result.sessionInfo = attached.getSessionInfo();

    await attached.disconnect(launchedSeed);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    if (seedConn.connected) {
      try {
        await seedConn.disconnect(true);
      } catch {
        // best effort
      }
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = defaultConfig();
  const paths = defaultPaths();
  const waitMs = toInt(args['wait-ms'], toInt(process.env.A_MCP_01_WAIT_MS, 2500));
  const outDir = path.resolve(args['out-dir'] || paths.outDir);
  const adfPath = path.resolve(args['adf'] || paths.adf);
  const bootAdfPath = path.resolve(args['boot-adf'] || paths.bootAdf);
  const dryRun = toBool(args['dry-run'], false);

  process.env.WINUAE_TRACE ??= '1';
  process.env.WINUAE_GDB_MAX_ATTEMPTS ??= '20';
  process.env.WINUAE_GDB_DELAY_MS ??= '750';
  process.env.WINUAE_GDB_INITIAL_DELAY_MS ??= '6500';

  ensureDir(outDir);

  const report = {
    generatedAt: new Date().toISOString(),
    config,
    inputs: {
      adfPath,
      bootAdfPath,
      waitMs,
      dryRun,
      portBusyAtStart: await checkPort(config.gdbPort),
    },
    phases: {},
  };
  const rows = [];

  if (!fs.existsSync(adfPath)) {
    report.phases.error = `ADF not found: ${adfPath}`;
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outDir, 'report.md'), `# A-MCP-01 Matrix\n\nADF not found: \`${adfPath}\`\n`);
    console.error(`ADF not found: ${adfPath}`);
    process.exit(1);
  }

  const { WinUAEConnection } = await importConnection();
  const drives = [0, 1, 2, 3];

  if (!dryRun) {
    if (!report.inputs.portBusyAtStart) {
      report.phases.launch = {};
      for (const drive of drives) {
        const detail = await launchWithDrive(WinUAEConnection, config, drive, adfPath, bootAdfPath, waitMs);
        report.phases.launch[`df${drive}`] = detail;
        rows.push({
          phase: 'launch',
          drive: `DF${drive}`,
          mode: 'connect',
          operation: 'connect',
          status: detail.connectStatus,
          detail: detail.pcBefore ? `PC ${detail.pcBefore}` : detail.error || 'no register read',
        });
        rows.push({
          phase: 'launch',
          drive: `DF${drive}`,
          mode: 'connect',
          operation: 'restart',
          status: detail.restartStatus,
          detail: detail.pcAfter ? `PC ${detail.pcBefore} -> ${detail.pcAfter}` : detail.error || 'restart unavailable',
        });
      }
    } else {
      report.phases.launch = { skipped: 'GDB port busy at start; launch() phase skipped to avoid killing an unknown emulator.' };
    }

    const existingPhase = await runExistingHotSwap(
      WinUAEConnection,
      config,
      adfPath,
      drives,
      waitMs,
      !report.inputs.portBusyAtStart
    );
    report.phases.connectExisting = existingPhase;
    for (const row of existingPhase.rows) {
      rows.push({
        phase: 'existing',
        drive: `DF${row.drive}`,
        mode: 'connect_existing',
        operation: row.operation,
        status: row.status,
        detail: row.detail,
      });
    }
    report.phases.connectExisting.rows = existingPhase.rows;
  } else {
    report.phases.launch = { skipped: 'dry-run requested' };
    report.phases.connectExisting = { skipped: 'dry-run requested' };
  }

  const counts = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.status.toLowerCase()] = (acc[row.status.toLowerCase()] || 0) + 1;
      return acc;
    },
    { total: 0, pass: 0, fail: 0, skip: 0 }
  );

  report.summary = counts;

  const markdown = [
    '# A-MCP-01 Matrix',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Inputs',
    '',
    `- ADF: \`${adfPath}\``,
    `- Boot ADF: \`${bootAdfPath}\``,
    `- WinUAE path: \`${config.winuaePath}\``,
    `- Config: \`${config.configFile}\``,
    `- GDB port: \`${config.gdbPort}\``,
    `- Wait: \`${waitMs}ms\``,
    `- Port busy at start: \`${report.inputs.portBusyAtStart}\``,
    '',
    '## Results',
    '',
    formatStatusTable(rows),
    '',
    '## Summary',
    '',
    `- Total: ${counts.total}`,
    `- Pass: ${counts.pass}`,
    `- Fail: ${counts.fail}`,
    `- Skip: ${counts.skip}`,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), markdown);

  console.log(markdown);
  if (counts.fail > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
