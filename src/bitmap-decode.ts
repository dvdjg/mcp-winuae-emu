import { deflateSync } from 'node:zlib';
import { CustomRegisterSnapshot, hex32 } from './machine-snapshot.js';

export const MAX_BITMAP_DECODE_BYTES = 0x40000;
export const MAX_INLINE_RGBA_BYTES = 0x10000;

export type BitmapLayout = 'interleaved' | 'planar';
export type BitmapColorMode = 'auto' | 'direct' | 'ehb';

export interface BitmapDecodeOptions {
  width: number;
  height: number;
  depth: number;
  rowBytes?: number;
  layout?: BitmapLayout;
  colorMode?: BitmapColorMode;
  palette?: string[];
}

export interface BitmapDecodeRequest {
  address: number;
  width: number;
  height: number;
  depth: number;
  rowBytes: number;
  layout: BitmapLayout;
  colorMode: Exclude<BitmapColorMode, 'auto'>;
  bytesToRead: number;
}

export interface DecodedBitmap {
  width: number;
  height: number;
  depth: number;
  row_bytes: number;
  layout: BitmapLayout;
  color_mode: Exclude<BitmapColorMode, 'auto'>;
  palette_source: 'args' | 'custom';
  palette_hex: string[];
  rgba: Buffer;
  bytes_read: number;
}

type RgbaColor = readonly [number, number, number, number];

export function normalizeBitmapDecodeRequest(options: BitmapDecodeOptions): BitmapDecodeRequest {
  const width = Math.trunc(options.width);
  const height = Math.trunc(options.height);
  const depth = Math.trunc(options.depth);

  if (!Number.isFinite(width) || width <= 0) {
    throw new Error('width must be a positive integer');
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('height must be a positive integer');
  }
  if (!Number.isFinite(depth) || depth < 1 || depth > 6) {
    throw new Error('depth must be an integer between 1 and 6');
  }

  const rowBytes = options.rowBytes ?? defaultRowBytes(width);
  if (!Number.isFinite(rowBytes) || rowBytes <= 0) {
    throw new Error('row_bytes must be a positive integer');
  }

  const bytesToRead = rowBytes * height * depth;
  if (bytesToRead > MAX_BITMAP_DECODE_BYTES) {
    throw new Error(`bitmap payload too large (${bytesToRead} bytes > ${MAX_BITMAP_DECODE_BYTES})`);
  }

  const layout = options.layout ?? 'interleaved';
  const colorMode = resolveColorMode(options.colorMode ?? 'auto', depth, options.palette);

  return {
    address: 0,
    width,
    height,
    depth,
    rowBytes,
    layout,
    colorMode,
    bytesToRead,
  };
}

export function decodePlanarBitmap(
  bitmap: Buffer,
  request: Omit<BitmapDecodeRequest, 'address' | 'bytesToRead'>,
  customSnapshot: CustomRegisterSnapshot | undefined,
  paletteValues?: string[]
): DecodedBitmap {
  const palette = resolvePalette(request.depth, request.colorMode, paletteValues, customSnapshot);
  const paletteHex = palette.map(formatColorHex);
  const rgba = Buffer.alloc(request.width * request.height * 4);

  for (let y = 0; y < request.height; y++) {
    for (let x = 0; x < request.width; x++) {
      let colorIndex = 0;
      const byteOffset = x >> 3;
      const bitMask = 1 << (7 - (x & 7));

      for (let plane = 0; plane < request.depth; plane++) {
        const planeOffset = request.layout === 'interleaved'
          ? y * request.rowBytes * request.depth + plane * request.rowBytes
          : plane * request.rowBytes * request.height + y * request.rowBytes;
        const bit = (bitmap[planeOffset + byteOffset] & bitMask) !== 0 ? 1 : 0;
        colorIndex |= bit << plane;
      }

      const color = palette[colorIndex] ?? [0, 0, 0, 255];
      const pixelOffset = (y * request.width + x) * 4;
      rgba[pixelOffset] = color[0];
      rgba[pixelOffset + 1] = color[1];
      rgba[pixelOffset + 2] = color[2];
      rgba[pixelOffset + 3] = color[3];
    }
  }

  return {
    width: request.width,
    height: request.height,
    depth: request.depth,
    row_bytes: request.rowBytes,
    layout: request.layout,
    color_mode: request.colorMode,
    palette_source: paletteValues?.length ? 'args' : 'custom',
    palette_hex: paletteHex,
    rgba,
    bytes_read: bitmap.length,
  };
}

export function encodePngRgba(width: number, height: number, rgba: Buffer): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error('RGBA buffer length does not match width*height*4');
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlineLength = width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(raw);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function rgbaToHex(rgba: Buffer): string {
  if (rgba.length > MAX_INLINE_RGBA_BYTES) {
    throw new Error(`RGBA payload too large for inline return (${rgba.length} bytes > ${MAX_INLINE_RGBA_BYTES})`);
  }
  return rgba.toString('hex').toUpperCase();
}

export function defaultRowBytes(width: number): number {
  return Math.ceil(width / 16) * 2;
}

export function buildBitmapDecodeResponse(decoded: DecodedBitmap, address: number, pngPath?: string, rgbaHex?: string) {
  return {
    bitmap: {
      address: hex32(address),
      width: decoded.width,
      height: decoded.height,
      depth: decoded.depth,
      row_bytes: decoded.row_bytes,
      layout: decoded.layout,
      color_mode: decoded.color_mode,
      bytes_read: decoded.bytes_read,
    },
    palette_source: decoded.palette_source,
    palette_hex: decoded.palette_hex,
    png_file: pngPath,
    rgba_hex: rgbaHex,
  };
}

function resolveColorMode(mode: BitmapColorMode, depth: number, paletteValues?: string[]): Exclude<BitmapColorMode, 'auto'> {
  if (mode === 'direct' || mode === 'ehb') {
    return mode;
  }
  if (depth === 6 && !paletteValues?.length) {
    return 'ehb';
  }
  return 'direct';
}

function resolvePalette(
  depth: number,
  colorMode: Exclude<BitmapColorMode, 'auto'>,
  paletteValues: string[] | undefined,
  customSnapshot: CustomRegisterSnapshot | undefined
): RgbaColor[] {
  if (paletteValues?.length) {
    return buildPaletteFromArgs(depth, colorMode, paletteValues);
  }
  if (!customSnapshot) {
    throw new Error('palette not provided and custom snapshot unavailable');
  }
  return buildPaletteFromCustom(depth, colorMode, customSnapshot);
}

function buildPaletteFromArgs(depth: number, colorMode: Exclude<BitmapColorMode, 'auto'>, paletteValues: string[]): RgbaColor[] {
  const requiredColors = colorMode === 'ehb' ? 32 : (1 << depth);
  if (paletteValues.length < requiredColors) {
    throw new Error(`palette requires at least ${requiredColors} entries for ${colorMode} mode`);
  }

  const base = paletteValues.slice(0, requiredColors).map(parseColorString);
  return colorMode === 'ehb' ? expandEhbPalette(base) : base;
}

function buildPaletteFromCustom(depth: number, colorMode: Exclude<BitmapColorMode, 'auto'>, customSnapshot: CustomRegisterSnapshot): RgbaColor[] {
  const base: RgbaColor[] = [];
  for (let i = 0; i < 32; i++) {
    const registerName = `COLOR${i.toString().padStart(2, '0')}`;
    const entry = customSnapshot.registers[registerName];
    if (!entry) {
      throw new Error(`custom snapshot missing ${registerName}`);
    }
    base.push(expandAmigaColor12(entry.value_dec));
  }

  if (colorMode === 'ehb') {
    return expandEhbPalette(base);
  }

  const required = 1 << depth;
  return base.slice(0, required);
}

function expandEhbPalette(base: RgbaColor[]): RgbaColor[] {
  const padded = base.slice(0, 32);
  while (padded.length < 32) {
    padded.push([0, 0, 0, 255]);
  }
  const halfbrite = padded.map((color) => [
    color[0] >> 1,
    color[1] >> 1,
    color[2] >> 1,
    255,
  ] as const);
  return [...padded, ...halfbrite];
}

function parseColorString(value: string): RgbaColor {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      const r = parseInt(trimmed[1] + trimmed[1], 16);
      const g = parseInt(trimmed[2] + trimmed[2], 16);
      const b = parseInt(trimmed[3] + trimmed[3], 16);
      return [r, g, b, 255];
    }
    if (trimmed.length === 7) {
      const rgb = parseInt(trimmed.slice(1), 16);
      return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255];
    }
  }

  let raw = trimmed;
  if (raw.startsWith('$')) {
    raw = raw.slice(1);
  } else if (raw.startsWith('0x') || raw.startsWith('0X')) {
    raw = raw.slice(2);
  }

  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`invalid color value: ${value}`);
  }

  if (raw.length <= 3) {
    return expandAmigaColor12(parseInt(raw, 16));
  }

  const rgb = parseInt(raw, 16);
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255];
}

function expandAmigaColor12(value: number): RgbaColor {
  const r = ((value >> 8) & 0x0f) * 17;
  const g = ((value >> 4) & 0x0f) * 17;
  const b = (value & 0x0f) * 17;
  return [r, g, b, 255];
}

function formatColorHex(color: RgbaColor): string {
  return '#' + color[0].toString(16).padStart(2, '0').toUpperCase()
    + color[1].toString(16).padStart(2, '0').toUpperCase()
    + color[2].toString(16).padStart(2, '0').toUpperCase();
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
