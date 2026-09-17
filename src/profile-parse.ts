/**
 * Parser del formato binario de perfil de WinUAE-DBG (mismo que produce
 * `monitor profile`/canal lateral y que la extension vscode-amiga-debug
 * consume en src/backend/profile.ts).
 *
 * Por frame incluye: registros custom (chipset flags + 256 regs de 16 bits),
 * tabla de colores AGA (opcional, 256x32 bits), registros DMA, recursos
 * graficos (bitplanes/paleta), ciclos de perfil/idle y una captura de
 * pantalla (jpg o png) embebida.
 */
export interface ProfileGfxResource {
  address: number;
  size: number;
  name: string;
  type: number; // 0 = bitmap, 1 = palette
  flags: number;
  width?: number;
  height?: number;
  numPlanes?: number;
  numEntries?: number;
}

export interface ProfileFrame {
  chipsetFlags: number;
  customRegs: number[]; // 256 x uint16
  agaColors: number[]; // 256 x uint32 (vacio si no hay tabla)
  dmaSummary: { total: number; byType: Record<number, number> };
  gfxResources: ProfileGfxResource[];
  profileCycles: number;
  idleCycles: number;
  /** Una entrada u32 por muestra = PC donde estaba la CPU (vacio si no hubo unwind). */
  profileArray: number[];
  screenshotType: 'jpg' | 'png';
  screenshotSize: number;
  screenshot: Buffer;
}

export interface Profile {
  sectionBases: number[];
  systemStackLower: number;
  systemStackUpper: number;
  stackLower: number;
  stackUpper: number;
  kickRomSize: number;
  chipMemSize: number;
  bogoMemSize: number;
  baseClock: number;
  cpuCycleUnit: number;
  frames: ProfileFrame[];
}

const AGA_COLORS_LEN = 256 * 4; // 1024
const DMA_REC_LEGACY = 58;
const DMA_REC_EXTENDED = 121;

function bufferOffsetOf(buffer: Buffer, offset: number): number {
  return buffer.byteOffset + offset;
}

export function parseProfile(buffer: Buffer): Profile {
  const out: Profile = {
    sectionBases: [],
    systemStackLower: 0,
    systemStackUpper: 0,
    stackLower: 0,
    stackUpper: 0,
    kickRomSize: 0,
    chipMemSize: 0,
    bogoMemSize: 0,
    baseClock: 0,
    cpuCycleUnit: 0,
    frames: [],
  };
  let o = 0;
  const numFrames = buffer.readUInt32LE(o); o += 4;
  const sectionCount = buffer.readUInt32LE(o); o += 4;

  for (let i = 0; i < sectionCount; i++) {
    out.sectionBases.push(buffer.readUInt32LE(o)); o += 4;
  }
  out.systemStackLower = buffer.readUInt32LE(o); o += 4;
  out.systemStackUpper = buffer.readUInt32LE(o); o += 4;
  out.stackLower = buffer.readUInt32LE(o); o += 4;
  out.stackUpper = buffer.readUInt32LE(o); o += 4;
  out.kickRomSize = buffer.readUInt32LE(o); o += 4; o += out.kickRomSize;
  out.chipMemSize = buffer.readUInt32LE(o); o += 4; o += out.chipMemSize;
  out.bogoMemSize = buffer.readUInt32LE(o); o += 4; o += out.bogoMemSize;
  out.baseClock = buffer.readUInt32LE(o); o += 4;
  out.cpuCycleUnit = buffer.readUInt32LE(o); o += 4;

  for (let f = 0; f < numFrames; f++) {
    const frame: ProfileFrame = {
      chipsetFlags: 0,
      customRegs: [],
      agaColors: [],
      dmaSummary: { total: 0, byType: {} },
      gfxResources: [],
      profileCycles: 0,
      idleCycles: 0,
      profileArray: [],
      screenshotType: 'jpg',
      screenshotSize: 0,
      screenshot: Buffer.alloc(0),
    };
    try {
      // custom registers: len + chipsetFlags(4 BE) + 256 regs (512)
      const customRegsLen = buffer.readUInt32LE(o); o += 4;
      const customRegsStart = o;
      frame.chipsetFlags = buffer.readUInt32BE(o); o += 4;
      for (let i = 0; i < 256; i++) {
        frame.customRegs.push(buffer.readUInt16BE(o)); o += 2;
      }
      o = customRegsStart + customRegsLen;

      // AGA colors (opcional)
      const agaColorsLen = buffer.readUInt32LE(o); o += 4;
      if (agaColorsLen === AGA_COLORS_LEN) {
        for (let i = 0; i < 256; i++) {
          frame.agaColors.push(buffer.readUInt32BE(o)); o += 4;
        }
      }

      // DMA
      const dmaLen = buffer.readUInt32LE(o); o += 4;
      const dmaCount = buffer.readUInt32LE(o); o += 4;
      const isExtended = dmaLen === DMA_REC_EXTENDED;
      const typeOffset = isExtended ? 77 : 29;
      const dmaBuf = Buffer.from(buffer.buffer, bufferOffsetOf(buffer, o), dmaLen * dmaCount);
      o += dmaLen * dmaCount;
      for (let i = 0; i < dmaCount; i++) {
        const type = dmaBuf.readInt16LE(i * dmaLen + typeOffset);
        if (type !== 0 && type !== undefined) {
          frame.dmaSummary.total++;
          frame.dmaSummary.byType[type] = (frame.dmaSummary.byType[type] || 0) + 1;
        }
      }

      // resources (bitplanes, paleta)
      const resourceLen = buffer.readUInt32LE(o); o += 4;
      const resourceCount = buffer.readUInt32LE(o); o += 4;
      const resBuf = Buffer.from(buffer.buffer, bufferOffsetOf(buffer, o), resourceLen * resourceCount);
      o += resourceLen * resourceCount;
      for (let i = 0; i < resourceCount; i++) {
        const base = i * resourceLen;
        const res: ProfileGfxResource = {
          address: resBuf.readUInt32LE(base + 0),
          size: resBuf.readUInt32LE(base + 4),
          name: '',
          type: resBuf.readUInt16LE(base + 40),
          flags: resBuf.readUInt16LE(base + 42),
        };
        let nameEnd = resBuf.indexOf(0, base + 8);
        if (nameEnd === -1) nameEnd = base + 40;
        res.name = resBuf.toString('utf8', base + 8, nameEnd);
        if (res.type === 0) {
          res.width = resBuf.readUInt16LE(base + 44);
          res.height = resBuf.readUInt16LE(base + 46);
          res.numPlanes = resBuf.readUInt16LE(base + 48);
        } else if (res.type === 1) {
          res.numEntries = resBuf.readUInt16LE(base + 44);
        }
        frame.gfxResources.push(res);
      }

      frame.profileCycles = buffer.readUInt32LE(o); o += 4;
      frame.idleCycles = buffer.readUInt32LE(o); o += 4;

      // profile array: una entrada u32 por muestra = PC donde estaba la CPU.
      // Se resuelven a rutina con el .map/ELF (runtime -> linked). Requiere que
      // WinUAE haya recibido la tabla .unwind; si no, profileCount es 0.
      const profileCount = buffer.readUInt32LE(o); o += 4;
      frame.profileArray = new Array(profileCount);
      for (let i = 0; i < profileCount; i++) {
        frame.profileArray[i] = buffer.readUInt32LE(o); o += 4;
      }

      // screenshot
      const screenshotSize = buffer.readUInt32LE(o); o += 4;
      const screenshotType = buffer.readUInt32LE(o); o += 4;
      frame.screenshotType = screenshotType === 0 ? 'jpg' : 'png';
      frame.screenshotSize = screenshotSize;
      frame.screenshot = Buffer.from(buffer.buffer, bufferOffsetOf(buffer, o), screenshotSize);
      o += screenshotSize;

      out.frames.push(frame);
    } catch (e) {
      throw new Error(
        `Fallo en frame ${f} (offset 0x${o.toString(16)}): ${(e as Error).message}`
      );
    }
  }
  return out;
}
