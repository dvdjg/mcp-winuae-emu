/**
 * Trace/logging for mcp-winuae-emu debugging.
 * Set WINUAE_TRACE=1 to enable. Logs to stderr and optionally to a file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TRACE_ENABLED = process.env.WINUAE_TRACE === '1';
let logFd: number | null = null;
const logDir = path.join(os.tmpdir(), 'winuae-mcp');

function ensureLogFile(): number | null {
  if (logFd !== null) return logFd;
  if (!TRACE_ENABLED) return null;
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `mcp-trace-${Date.now()}.log`);
    logFd = fs.openSync(logPath, 'w');
    const ts = new Date().toISOString();
    fs.writeSync(logFd!, `[${ts}] MCP WinUAE trace started. WINUAE_PATH=${process.env.WINUAE_PATH} WINUAE_EXE=${process.env.WINUAE_EXE}\n`);
    return logFd;
  } catch {
    return null;
  }
}

export function trace(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stderr.write(`[WinUAE] ${msg}\n`);
  if (TRACE_ENABLED) {
    const fd = ensureLogFile();
    if (fd !== null) {
      try { fs.writeSync(fd, line); } catch {}
    }
  }
}

export function traceErr(msg: string, err?: unknown): void {
  const errStr = err instanceof Error ? err.message : String(err);
  trace(`${msg} ${errStr}`);
}

export function getLogDir(): string {
  return logDir;
}
