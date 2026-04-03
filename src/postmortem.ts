import { M68kRegisters } from './gdb-protocol.js';
import {
  buildCpuSnapshot,
  buildCustomRegisterSnapshot,
  buildMachineSnapshot,
  buildMemoryWindowErrorSnapshot,
  buildMemoryWindowSnapshot,
  CUSTOM_REGISTER_CHUNK_SIZE,
  CUSTOM_REGISTER_SIZE,
  readMemoryWindowChunked,
  normalizeMemoryWindow,
} from './machine-snapshot.js';

export interface PostmortemOptions {
  stopReply?: string | null;
  stackBytes?: number;
  disasmCount?: number;
  includeCustom?: boolean;
  includeChipWindow?: boolean;
  chipWindowAddress?: number;
  chipWindowBytes?: number;
}

export interface PostmortemDependencies {
  protocol: {
    readRegisters(): Promise<M68kRegisters>;
    readMemory(address: number, length: number): Promise<Buffer>;
    sendMonitorCommand(command: string, timeoutMs?: number): Promise<string>;
  };
  customRegs: Record<number, string>;
}

function hex32(v: number): string {
  return '$' + (v >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function mapGdbSignal(signal: number): { signal_name: string; likely_exception: string } {
  switch (signal) {
    case 4:
      return { signal_name: 'SIGILL', likely_exception: 'Illegal instruction / invalid opcode' };
    case 5:
      return { signal_name: 'SIGTRAP', likely_exception: 'Breakpoint / trace trap' };
    case 7:
      return { signal_name: 'SIGEMT', likely_exception: 'TRAP / emulator trap / software trap' };
    case 8:
      return { signal_name: 'SIGFPE', likely_exception: 'Arithmetic exception' };
    case 10:
      return { signal_name: 'SIGBUS', likely_exception: 'Bus error / misaligned or bad bus cycle' };
    case 11:
      return { signal_name: 'SIGSEGV', likely_exception: 'Address error / invalid memory access' };
    default:
      return { signal_name: `SIG${signal}`, likely_exception: 'Unknown / target-specific stop' };
  }
}

export function parseStopReply(stopReply?: string | null): Record<string, unknown> | null {
  if (!stopReply) {
    return null;
  }

  const normalized = String(stopReply).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('S') && normalized.length >= 3) {
    const signal = parseInt(normalized.slice(1, 3), 16);
    if (!Number.isNaN(signal)) {
      return {
        raw: normalized,
        kind: 'signal',
        signal_number: signal,
        ...mapGdbSignal(signal),
      };
    }
  }

  if (normalized.startsWith('T') && normalized.length >= 3) {
    const signal = parseInt(normalized.slice(1, 3), 16);
    const base = Number.isNaN(signal)
      ? { raw: normalized, kind: 'trap' }
      : {
          raw: normalized,
          kind: 'trap',
          signal_number: signal,
          ...mapGdbSignal(signal),
        };

    const fields: Record<string, string> = {};
    const pairs = normalized.slice(3).split(';').filter(Boolean);
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        fields[pair.slice(0, idx)] = pair.slice(idx + 1);
      }
    }

    return {
      ...base,
      fields,
    };
  }

  return {
    raw: normalized,
    kind: 'unknown',
  };
}

export async function buildPostmortemReport(
  deps: PostmortemDependencies,
  options: PostmortemOptions = {}
): Promise<Record<string, unknown>> {
  const protocol = deps.protocol;
  const regs = await protocol.readRegisters();
  const sp = regs.A7 >>> 0;
  const pc = regs.PC >>> 0;
  const stackBytes = Math.max(0, Math.min(1024, Math.trunc(options.stackBytes ?? 128)));
  const disasmCount = Math.max(4, Math.min(64, Math.trunc(options.disasmCount ?? 12)));
  const includeCustom = options.includeCustom !== false;
  const includeChipWindow = options.includeChipWindow === true;

  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    stop: parseStopReply(options.stopReply),
    cpu: buildCpuSnapshot(regs),
    analysis: {
      pc: hex32(pc),
      sp: hex32(sp),
      notes: [
        'Postmortem captured from MCP after stop, pause, or failure handling.',
        'On 68000 targets, SIGILL/SIGBUS/SIGSEGV are mapped heuristically to likely exception classes.',
      ],
    },
  };

  const stackResult: Record<string, unknown> = {
    address: hex32(sp),
    bytes_requested: stackBytes,
  };
  if (stackBytes > 0) {
    try {
      const stack = await protocol.readMemory(sp, stackBytes);
      stackResult.bytes_read = stack.length;
      stackResult.hex = stack.toString('hex').toUpperCase();
      const words: string[] = [];
      for (let i = 0; i + 3 < stack.length; i += 4) {
        words.push(hex32(stack.readUInt32BE(i)));
      }
      stackResult.longwords = words;
    } catch (error) {
      stackResult.error = String((error as Error)?.message || error);
    }
  }
  report.stack = stackResult;

  try {
    const start = pc >= 16 ? pc - 16 : 0;
    const hexReply = await protocol.sendMonitorCommand(`disasm ${start.toString(16)} ${disasmCount}`, 10000);
    report.disassembly = {
      start_address: hex32(start),
      count: disasmCount,
      text: Buffer.from(hexReply, 'hex').toString('utf8'),
    };
  } catch (error) {
    report.disassembly = {
      error: String((error as Error)?.message || error),
    };
  }

  const snapshot = buildMachineSnapshot({}) as unknown as Record<string, unknown>;
  if (includeCustom) {
    try {
      const raw = await protocol.readMemory(0xDFF000, CUSTOM_REGISTER_SIZE);
      snapshot.custom = buildCustomRegisterSnapshot(raw, deps.customRegs, []);
    } catch (error) {
      (report as Record<string, unknown>).custom_error = String((error as Error)?.message || error);
    }
  }

  if (includeChipWindow) {
    const chipWindow = normalizeMemoryWindow({
      address: options.chipWindowAddress ?? 0,
      bytes: options.chipWindowBytes ?? 0x400,
    }, 0);
    if (chipWindow) {
      snapshot.memory = (snapshot.memory as Record<string, unknown> | undefined) || {};
      try {
        const data = await readMemoryWindowChunked(protocol, chipWindow);
        (snapshot.memory as Record<string, unknown>).chip = buildMemoryWindowSnapshot(chipWindow, data);
      } catch (error) {
        (snapshot.memory as Record<string, unknown>).chip = buildMemoryWindowErrorSnapshot(chipWindow, error);
      }
    }
  }

  report.snapshot = snapshot;
  return report;
}

export function renderPostmortemMarkdown(report: Record<string, unknown>): string {
  const stop = report.stop as Record<string, unknown> | null | undefined;
  const cpu = report.cpu as Record<string, unknown> | null | undefined;
  const disassembly = report.disassembly as Record<string, unknown> | null | undefined;
  const stack = report.stack as Record<string, unknown> | null | undefined;

  const lines = [
    '# WinUAE Postmortem',
    '',
    `- Timestamp: ${String(report.timestamp || '')}`,
    `- Stop: ${stop ? JSON.stringify(stop) : '(none)'}`,
    `- PC: ${String((cpu?.PC as string) || (cpu?.pc as string) || '')}`,
    `- A7: ${String((cpu?.A7 as string) || (cpu?.a7 as string) || '')}`,
    '',
    '## Stack',
    '',
    '```text',
    stack ? JSON.stringify(stack, null, 2) : '(none)',
    '```',
    '',
    '## Disassembly',
    '',
    '```text',
    String(disassembly?.text || JSON.stringify(disassembly || {}, null, 2)),
    '```',
    '',
  ];
  return lines.join('\n');
}
