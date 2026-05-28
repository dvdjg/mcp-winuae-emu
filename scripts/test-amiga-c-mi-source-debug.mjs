#!/usr/bin/env node
/**
 * End-to-end MI test for the normal vscode-amiga-debug path:
 * WinUAE-DBG + m68k-amiga-elf-gdb MI + source breakpoints + instruction step + pause.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter, once } from 'events';

const AMIGA_C = process.env.AMIGA_C_ROOT || 'C:/Users/David/Documents/Programa/Amiga/Amiga-C';
const EXT = process.env.AMIGA_DEBUG_EXT || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2';
const BIN = path.join(EXT, 'bin/win32');
const WINUAE = process.env.WINUAE_EXE_PATH || path.join(BIN, 'winuae-gdb.exe');
const GDB = process.env.M68K_GDB || path.join(BIN, 'opt/bin/m68k-amiga-elf-gdb.exe');
const ELF = path.join(AMIGA_C, 'out/a.elf');
const UAE_CONFIG = process.env.WINUAE_CONFIG || path.join(AMIGA_C, 'config/mcp-amiga-c-debug.uae');
const SOURCE = path.join(AMIGA_C, 'main.c').replace(/\\/g, '/');
const BREAK_LINE = parseInt(process.env.AMIGA_C_BREAK_LINE || '43', 10);
const STARTUP = path.join(EXT, 'bin/dh0/s/startup-sequence');
const USE_ALWAYS_INSERTED = process.env.TEST_ALWAYS_INSERTED === '1';
const SKIP_QOFFSETS = process.env.TEST_SKIP_QOFFSETS === '1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[mi-test] ${message}`);
}

function ensureFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}`);
  }
}

class MI extends EventEmitter {
  constructor() {
    super();
    this.token = 1;
    this.buffer = '';
    this.pending = new Map();
    this.lines = [];
    this.proc = spawn(GDB, ['-q', '--interpreter=mi2', '-l', '10', ELF], {
      cwd: AMIGA_C,
      env: {
        ...process.env,
        XDG_CACHE_HOME: GDB,
        HOME: GDB,
      },
    });
    this.proc.stdout.on('data', (data) => this.onData(data.toString('utf8')));
    this.proc.stderr.on('data', (data) => process.stderr.write(data));
    this.proc.on('exit', (code, signal) => this.emit('exit', { code, signal }));
    this.proc.on('error', (error) => this.emit('error', error));
  }

  onData(data) {
    this.buffer += data;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.buffer.slice(0, nl).trimEnd();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line || /^\d+\(gdb\)/.test(line) || line === '(gdb)') continue;
      if (process.env.MI_TRACE === '1') console.log(`[mi rx] ${line}`);
      const result = /^(\d+)\^(done|running|connected|error|exit)(?:,(.*))?$/.exec(line);
      if (result) {
        const token = parseInt(result[1], 10);
        const pending = this.pending.get(token);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(token);
          const node = { line, cls: result[2], payload: result[3] || '' };
          if (node.cls === 'error') pending.reject(new Error(`${pending.command}: ${line}`));
          else pending.resolve(node);
        }
        continue;
      }
      this.lines.push(line);
      this.emit('line', line);
    }
  }

  command(command, timeoutMs = 30000) {
    const token = this.token++;
    if (process.env.MI_TRACE === '1') console.log(`[mi tx] ${token}-${command}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        reject(new Error(`Timeout running ${command}`));
      }, timeoutMs);
      this.pending.set(token, { resolve, reject, timer, command });
      this.proc.stdin.write(`${token}-${command}\n`);
    });
  }

  async waitFor(pattern, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const queuedIndex = this.lines.findIndex((line) => pattern.test(line));
      if (queuedIndex >= 0) {
        const [line] = this.lines.splice(queuedIndex, 1);
        return line;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timeout waiting for ${label}`);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), remaining));
      const [line] = await Promise.race([once(this, 'line'), timeout]);
      if (pattern.test(line)) return line;
    }
  }

  dispose() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disposed'));
    }
    this.pending.clear();
    if (this.proc && !this.proc.killed) this.proc.kill();
  }
}

async function main() {
  ensureFile(WINUAE);
  ensureFile(GDB);
  ensureFile(ELF);
  ensureFile(UAE_CONFIG);
  ensureFile(SOURCE);

  fs.mkdirSync(path.dirname(STARTUP), { recursive: true });
  fs.writeFileSync(STARTUP, 'cd dh1:\n:a.exe\n', 'utf8');
  let configText = fs.readFileSync(UAE_CONFIG, 'utf8');
  configText = configText.replace(
    /^filesystem=rw,dh0:.*$/m,
    `filesystem=rw,dh0:${path.join(EXT, 'bin/dh0')}`
  );
  fs.writeFileSync(path.join(BIN, 'default.uae'), configText, 'utf8');

  log(`Launching ${WINUAE}`);
  const winuae = spawn(WINUAE, ['-portable'], {
    cwd: BIN,
    stdio: 'ignore',
    windowsHide: true,
  });

  let mi;
  try {
    await sleep(parseInt(process.env.WINUAE_GDB_INITIAL_DELAY_MS || '1500', 10));
    mi = new MI();

    await mi.command('gdb-set mi-async on', 10000);
    if (USE_ALWAYS_INSERTED) {
      log('Enabling breakpoint always-inserted (regression mode)');
      await mi.command('gdb-set breakpoint always-inserted on', 10000);
    }
    await mi.command('interpreter-exec console "target remote localhost:2345"', 90000);
    if (!SKIP_QOFFSETS) {
      await mi.command('interpreter-exec console "maintenance packet qOffsets"', 30000).catch(() => undefined);
    }

    const location = `"${SOURCE}:${BREAK_LINE}"`;
    log(`Source breakpoint ${location}`);
    const bp = await mi.command(`break-insert ${location}`, 30000);
    log(`break-insert ok: ${bp.line}`);

    await mi.command('exec-continue --thread 1', 10000);
    const hit = await mi.waitFor(/\*stopped,reason="breakpoint-hit"/, 90000, 'source breakpoint hit');
    log(`breakpoint hit: ${hit}`);

    await mi.command('exec-step-instruction --thread 1', 10000);
    const step = await mi.waitFor(/\*stopped,reason="end-stepping-range"/, 30000, 'instruction step stop');
    log(`stepi stop: ${step}`);

    await mi.command('break-delete 1', 10000);
    await mi.command('exec-continue --thread 1', 10000);
    await sleep(750);
    await mi.command('exec-interrupt --thread 1', 10000);
    const pause = await mi.waitFor(/\*stopped,reason="signal-received"/, 30000, 'pause stop');
    log(`pause stop: ${pause}`);

    await mi.command('gdb-exit', 5000).catch(() => undefined);
    log('PASS: MI source breakpoint, stepi and pause work');
  } finally {
    if (mi) mi.dispose();
    if (!winuae.killed) winuae.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
