import { hex32 } from './machine-snapshot.js';

const HUNK_HEADER = 0x000003f3;
const HUNK_CODE = 0x000003e9;
const HUNK_DATA = 0x000003ea;
const HUNK_BSS = 0x000003eb;
const HUNK_RELOC32 = 0x000003ec;
const HUNK_SYMBOL = 0x000003f0;
const HUNK_DEBUG = 0x000003f1;
const HUNK_END = 0x000003f2;

interface ParsedHunk {
  type: number;
  data: Buffer;
  bssBytes: number;
  relocs: Array<{ targetHunk: number; offsets: number[] }>;
}

export interface LoadedHunk {
  type: 'code' | 'data' | 'bss';
  baseAddress: number;
  sizeBytes: number;
  data: Buffer;
}

export interface LoadedAmigaHunkProgram {
  entryAddress: number;
  hunks: LoadedHunk[];
  totalBytes: number;
}

function readWord(buffer: Buffer, state: { offset: number }): number {
  if (state.offset + 4 > buffer.length) {
    throw new Error('Unexpected end of file while reading AmigaHunk word');
  }
  const value = buffer.readUInt32BE(state.offset);
  state.offset += 4;
  return value >>> 0;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function skipHunkSymbolBlock(buffer: Buffer, state: { offset: number }): void {
  while (true) {
    const nameLongs = readWord(buffer, state);
    if (nameLongs === 0) {
      return;
    }

    const symbolNameBytes = nameLongs * 4;
    if (state.offset + symbolNameBytes + 4 > buffer.length) {
      throw new Error('Unexpected end of file while skipping HUNK_SYMBOL block');
    }

    state.offset += symbolNameBytes;
    state.offset += 4; // symbol value
  }
}

function skipSizedHunkBlock(buffer: Buffer, state: { offset: number }, label: string): void {
  const longCount = readWord(buffer, state);
  const byteCount = longCount * 4;
  if (state.offset + byteCount > buffer.length) {
    throw new Error(`Unexpected end of file while skipping ${label}`);
  }
  state.offset += byteCount;
}

export function isAmigaHunkExecutable(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32BE(0) === HUNK_HEADER;
}

export function loadAmigaHunk(buffer: Buffer, loadAddress: number): LoadedAmigaHunkProgram {
  const state = { offset: 0 };
  const magic = readWord(buffer, state);
  if (magic !== HUNK_HEADER) {
    throw new Error('Not an AmigaHunk executable');
  }

  const residentNamesWords = readWord(buffer, state);
  if (residentNamesWords !== 0) {
    throw new Error('Unsupported AmigaHunk file: resident names table not supported');
  }

  const hunkCount = readWord(buffer, state);
  const firstHunk = readWord(buffer, state);
  const lastHunk = readWord(buffer, state);
  const expectedCount = lastHunk - firstHunk + 1;
  if (hunkCount !== expectedCount) {
    throw new Error(`Unsupported AmigaHunk header: hunk count mismatch (${hunkCount} vs ${expectedCount})`);
  }

  const sizesInLongs: number[] = [];
  for (let i = 0; i < hunkCount; i++) {
    sizesInLongs.push(readWord(buffer, state) & 0x3fffffff);
  }

  const parsedHunks: ParsedHunk[] = [];
  for (let hunkIndex = 0; hunkIndex < hunkCount; hunkIndex++) {
    const hunkType = readWord(buffer, state);
    const parsed: ParsedHunk = {
      type: hunkType,
      data: Buffer.alloc(0),
      bssBytes: 0,
      relocs: [],
    };

    if (hunkType === HUNK_CODE || hunkType === HUNK_DATA) {
      const longCount = readWord(buffer, state);
      const byteCount = longCount * 4;
      if (state.offset + byteCount > buffer.length) {
        throw new Error('Unexpected end of file while reading hunk payload');
      }
      parsed.data = Buffer.from(buffer.subarray(state.offset, state.offset + byteCount));
      state.offset += byteCount;
    } else if (hunkType === HUNK_BSS) {
      parsed.bssBytes = readWord(buffer, state) * 4;
      parsed.data = Buffer.alloc(parsed.bssBytes, 0);
    } else {
      throw new Error(`Unsupported AmigaHunk type ${hex32(hunkType)}`);
    }

    while (true) {
      const nextType = readWord(buffer, state);
      if (nextType === HUNK_END) {
        break;
      }
      if (nextType === HUNK_RELOC32) {
        while (true) {
          const count = readWord(buffer, state);
          if (count === 0) {
            break;
          }
          const targetHunk = readWord(buffer, state);
          const offsets: number[] = [];
          for (let i = 0; i < count; i++) {
            offsets.push(readWord(buffer, state));
          }
          parsed.relocs.push({ targetHunk, offsets });
        }
        continue;
      }
      if (nextType === HUNK_SYMBOL) {
        skipHunkSymbolBlock(buffer, state);
        continue;
      }
      if (nextType === HUNK_DEBUG) {
        skipSizedHunkBlock(buffer, state, 'HUNK_DEBUG');
        continue;
      }
      throw new Error(`Unsupported AmigaHunk secondary block ${hex32(nextType)}`);
    }

    parsedHunks.push(parsed);
  }

  const hunks: LoadedHunk[] = [];
  let cursor = loadAddress >>> 0;
  for (let i = 0; i < parsedHunks.length; i++) {
    const parsed = parsedHunks[i];
    const reservedBytes = Math.max(parsed.data.length, sizesInLongs[i] * 4);
    const type = parsed.type === HUNK_CODE ? 'code' : parsed.type === HUNK_DATA ? 'data' : 'bss';
    hunks.push({
      type,
      baseAddress: cursor,
      sizeBytes: reservedBytes,
      data: Buffer.from(parsed.data),
    });
    cursor += align4(reservedBytes);
  }

  for (let i = 0; i < parsedHunks.length; i++) {
    const parsed = parsedHunks[i];
    const loaded = hunks[i];
    for (const reloc of parsed.relocs) {
      const targetAddress = hunks[reloc.targetHunk]?.baseAddress;
      if (targetAddress === undefined) {
        throw new Error(`Relocation references unknown hunk ${reloc.targetHunk}`);
      }
      for (const offset of reloc.offsets) {
        if (offset + 4 > loaded.data.length) {
          throw new Error(`Relocation offset ${offset} outside hunk payload`);
        }
        const value = loaded.data.readUInt32BE(offset);
        loaded.data.writeUInt32BE((value + targetAddress) >>> 0, offset);
      }
    }
  }

  return {
    entryAddress: hunks[0]?.baseAddress ?? loadAddress,
    hunks,
    totalBytes: hunks.reduce((sum, hunk) => sum + align4(hunk.sizeBytes), 0),
  };
}
