import { hex32 } from './machine-snapshot.js';

export const MAX_PATTERN_SEARCH_BYTES = 0x40000;
export const MAX_PATTERN_HEX_BYTES = 0x2000;
export const MAX_PATTERN_CANDIDATES = 64;

export interface MemoryPatternSearchOptions {
  address: number;
  length: number;
  patternHex: string;
  strideBytes?: number;
  repeatCount?: number;
  maxResults?: number;
}

export interface NormalizedMemoryPatternSearchRequest {
  address: number;
  length: number;
  pattern: Buffer;
  strideBytes?: number;
  repeatCount: number;
  maxResults: number;
}

export interface MemoryPatternCandidate {
  address: string;
  offset: number;
  score: number;
  matched_rows: number;
  preview_hex: string;
}

function normalizeHexPattern(patternHex: string): Buffer {
  const clean = patternHex.replace(/\s+/g, '').replace(/^0x/i, '').replace(/^\$/, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('pattern_hex must contain an even number of hex digits');
  }
  const pattern = Buffer.from(clean, 'hex');
  if (pattern.length > MAX_PATTERN_HEX_BYTES) {
    throw new Error(`pattern_hex too large (${pattern.length} bytes > ${MAX_PATTERN_HEX_BYTES})`);
  }
  return pattern;
}

export function normalizeMemoryPatternSearchRequest(options: MemoryPatternSearchOptions): NormalizedMemoryPatternSearchRequest {
  const length = Math.trunc(options.length);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('length must be a positive integer');
  }
  if (length > MAX_PATTERN_SEARCH_BYTES) {
    throw new Error(`length too large (${length} bytes > ${MAX_PATTERN_SEARCH_BYTES})`);
  }

  const repeatCount = Math.max(1, Math.trunc(options.repeatCount ?? 1));
  const maxResults = Math.max(1, Math.min(MAX_PATTERN_CANDIDATES, Math.trunc(options.maxResults ?? 16)));
  const strideBytes = options.strideBytes !== undefined ? Math.trunc(options.strideBytes) : undefined;
  if (strideBytes !== undefined && strideBytes <= 0) {
    throw new Error('stride_bytes must be a positive integer');
  }

  return {
    address: options.address,
    length,
    pattern: normalizeHexPattern(options.patternHex),
    strideBytes,
    repeatCount,
    maxResults,
  };
}

function countStrideMatches(haystack: Buffer, start: number, pattern: Buffer, strideBytes: number, repeatCount: number): number {
  let matched = 0;
  for (let row = 0; row < repeatCount; row++) {
    const offset = start + row * strideBytes;
    if (offset + pattern.length > haystack.length) {
      break;
    }
    if (haystack.subarray(offset, offset + pattern.length).equals(pattern)) {
      matched++;
    } else {
      break;
    }
  }
  return matched;
}

export function searchMemoryPattern(haystack: Buffer, request: NormalizedMemoryPatternSearchRequest): MemoryPatternCandidate[] {
  const candidates: MemoryPatternCandidate[] = [];
  const limit = haystack.length - request.pattern.length;
  if (limit < 0) {
    return candidates;
  }

  for (let offset = 0; offset <= limit; offset++) {
    if (!haystack.subarray(offset, offset + request.pattern.length).equals(request.pattern)) {
      continue;
    }

    const matchedRows = request.strideBytes
      ? countStrideMatches(haystack, offset, request.pattern, request.strideBytes, request.repeatCount)
      : 1;
    const score = request.strideBytes
      ? matchedRows / request.repeatCount
      : 1;

    candidates.push({
      address: hex32(request.address + offset),
      offset,
      score,
      matched_rows: matchedRows,
      preview_hex: haystack
        .subarray(offset, Math.min(offset + Math.max(request.pattern.length, 16), haystack.length))
        .toString('hex')
        .toUpperCase(),
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.matched_rows !== a.matched_rows) return b.matched_rows - a.matched_rows;
    return a.offset - b.offset;
  });

  return candidates.slice(0, request.maxResults);
}

export function buildMemoryPatternSearchResponse(
  request: NormalizedMemoryPatternSearchRequest,
  candidates: MemoryPatternCandidate[]
) {
  return {
    search: {
      address: hex32(request.address),
      length: request.length,
      pattern_hex: request.pattern.toString('hex').toUpperCase(),
      stride_bytes: request.strideBytes ?? null,
      repeat_count: request.repeatCount,
      max_results: request.maxResults,
    },
    candidates,
  };
}
