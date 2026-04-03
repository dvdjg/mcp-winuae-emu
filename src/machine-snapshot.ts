import { M68kRegisters } from './gdb-protocol.js';

export const CUSTOM_REGISTER_BASE = 0xDFF000;
export const CUSTOM_REGISTER_SIZE = 0x200;
export const CUSTOM_REGISTER_CHUNK_SIZE = 0x40;
export const MAX_MACHINE_SNAPSHOT_WINDOW_BYTES = 0x4000;
export const MACHINE_SNAPSHOT_MEMORY_CHUNK_BYTES = 0x400;

export type CustomRegisterTable = Record<number, string>;

export interface MemoryWindowRequest {
  address?: number;
  bytes?: number;
}

export interface NormalizedMemoryWindow {
  address: number;
  requestedBytes: number;
  bytesToRead: number;
  truncated: boolean;
}

export interface CustomRegisterEntry {
  name: string;
  address: string;
  offset: string;
  value: string;
  value_dec: number;
}

export interface CustomRegisterSnapshot {
  base_address: string;
  bytes_read: number;
  unreadable_chunk_offsets: string[];
  registers: Record<string, CustomRegisterEntry>;
}

export interface MachineSnapshotMemoryWindow {
  address: string;
  requested_bytes: number;
  bytes_read: number;
  truncated: boolean;
  data_hex: string;
}

export interface MachineSnapshotMemoryWindowError {
  address: string;
  requested_bytes: number;
  bytes_read: number;
  truncated: boolean;
  error: string;
}

export interface MachineSnapshot {
  metadata: {
    custom_register_base: string;
    custom_register_bytes: number;
    custom_register_chunk_bytes: number;
    max_memory_window_bytes: number;
    memory_window_chunk_bytes: number;
  };
  cpu?: ReturnType<typeof buildCpuSnapshot>;
  custom?: CustomRegisterSnapshot;
  memory?: {
    chip?: MachineSnapshotMemoryWindow | MachineSnapshotMemoryWindowError;
    fast?: MachineSnapshotMemoryWindow | MachineSnapshotMemoryWindowError;
  };
}

export interface MemoryReader {
  readMemory(address: number, length: number): Promise<Buffer>;
}

export function hex32(v: number): string {
  return '$' + (v >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function hex16(v: number): string {
  return '$' + (v & 0xffff).toString(16).padStart(4, '0').toUpperCase();
}

function hexOffset(v: number): string {
  return '$' + (v & 0xffff).toString(16).padStart(3, '0').toUpperCase();
}

function buildSrFlags(sr: number): string[] {
  return [
    (sr & 0x8000) ? 'T1' : null,
    (sr & 0x4000) ? 'T0' : null,
    (sr & 0x2000) ? 'S' : null,
    (sr & 0x1000) ? 'M' : null,
    `IPL=${(sr >> 8) & 7}`,
    (sr & 0x10) ? 'X' : 'x',
    (sr & 0x08) ? 'N' : 'n',
    (sr & 0x04) ? 'Z' : 'z',
    (sr & 0x02) ? 'V' : 'v',
    (sr & 0x01) ? 'C' : 'c',
  ].filter((flag): flag is string => Boolean(flag));
}

export function buildCpuSnapshot(regs: M68kRegisters) {
  return {
    D0: hex32(regs.D0),
    D1: hex32(regs.D1),
    D2: hex32(regs.D2),
    D3: hex32(regs.D3),
    D4: hex32(regs.D4),
    D5: hex32(regs.D5),
    D6: hex32(regs.D6),
    D7: hex32(regs.D7),
    A0: hex32(regs.A0),
    A1: hex32(regs.A1),
    A2: hex32(regs.A2),
    A3: hex32(regs.A3),
    A4: hex32(regs.A4),
    A5: hex32(regs.A5),
    A6: hex32(regs.A6),
    A7: hex32(regs.A7),
    SR: hex16(regs.SR),
    SR_flags: buildSrFlags(regs.SR),
    PC: hex32(regs.PC),
  };
}

export function normalizeMemoryWindow(request: MemoryWindowRequest, defaultAddress: number): NormalizedMemoryWindow | null {
  const requestedBytes = Math.max(0, request.bytes ?? 0);
  if (requestedBytes === 0) {
    return null;
  }

  const bytesToRead = Math.min(requestedBytes, MAX_MACHINE_SNAPSHOT_WINDOW_BYTES);
  return {
    address: request.address ?? defaultAddress,
    requestedBytes,
    bytesToRead,
    truncated: bytesToRead !== requestedBytes,
  };
}

export function buildCustomRegisterSnapshot(
  data: Buffer,
  customRegs: CustomRegisterTable,
  unreadableChunkOffsets: number[] = []
): CustomRegisterSnapshot {
  const registers: Record<string, CustomRegisterEntry> = {};

  for (let offset = 0; offset < CUSTOM_REGISTER_SIZE; offset += 2) {
    const name = customRegs[offset];
    if (!name) {
      continue;
    }

    const value = data.readUInt16BE(offset);
    registers[name] = {
      name,
      address: hex32(CUSTOM_REGISTER_BASE + offset),
      offset: hexOffset(offset),
      value: hex16(value),
      value_dec: value,
    };
  }

  return {
    base_address: hex32(CUSTOM_REGISTER_BASE),
    bytes_read: data.length,
    unreadable_chunk_offsets: unreadableChunkOffsets.map(hexOffset),
    registers,
  };
}

export function buildMemoryWindowSnapshot(window: NormalizedMemoryWindow, data: Buffer): MachineSnapshotMemoryWindow {
  return {
    address: hex32(window.address),
    requested_bytes: window.requestedBytes,
    bytes_read: data.length,
    truncated: window.truncated,
    data_hex: data.toString('hex').toUpperCase(),
  };
}

export function buildMemoryWindowErrorSnapshot(window: NormalizedMemoryWindow, error: unknown): MachineSnapshotMemoryWindowError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    address: hex32(window.address),
    requested_bytes: window.requestedBytes,
    bytes_read: 0,
    truncated: window.truncated,
    error: message,
  };
}

export async function readMemoryWindowChunked(
  reader: MemoryReader,
  window: NormalizedMemoryWindow,
  chunkBytes: number = MACHINE_SNAPSHOT_MEMORY_CHUNK_BYTES
): Promise<Buffer> {
  if (window.bytesToRead === 0) {
    return Buffer.alloc(0);
  }

  const safeChunkBytes = Math.max(1, Math.trunc(chunkBytes));
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < window.bytesToRead) {
    const length = Math.min(safeChunkBytes, window.bytesToRead - offset);
    const chunk = await reader.readMemory(window.address + offset, length);
    chunks.push(chunk);
    offset += chunk.length;

    if (chunk.length !== length) {
      throw new Error(`Short read at ${hex32(window.address + offset - chunk.length)}: expected ${length} bytes, got ${chunk.length}`);
    }
  }

  return Buffer.concat(chunks);
}

export function buildMachineSnapshot(payload: Omit<MachineSnapshot, 'metadata'>): MachineSnapshot {
  return {
    metadata: {
      custom_register_base: hex32(CUSTOM_REGISTER_BASE),
      custom_register_bytes: CUSTOM_REGISTER_SIZE,
      custom_register_chunk_bytes: CUSTOM_REGISTER_CHUNK_SIZE,
      max_memory_window_bytes: MAX_MACHINE_SNAPSHOT_WINDOW_BYTES,
      memory_window_chunk_bytes: MACHINE_SNAPSHOT_MEMORY_CHUNK_BYTES,
    },
    ...payload,
  };
}
