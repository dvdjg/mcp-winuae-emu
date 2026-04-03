import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const AUTOMATION_INPUT_SIZE = 20;

const OFFSETS = {
  enabled: 0,
  mouseLeft: 1,
  mouseRight: 2,
  mouseXHi: 4,
  mouseXLo: 5,
  mouseYHi: 6,
  mouseYLo: 7,
  joy0: 8,
  joy1: 13,
  key: 18,
} as const;

export interface AutomationInputState {
  enabled: boolean;
  mouseLeft: boolean;
  mouseRight: boolean;
  mouseX: number;
  mouseY: number;
  joy0: Record<'fire' | 'up' | 'down' | 'left' | 'right', boolean>;
  joy1: Record<'fire' | 'up' | 'down' | 'left' | 'right', boolean>;
  keycode: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function writeBool(buffer: Buffer, offset: number, value: boolean | undefined): void {
  if (value === undefined) return;
  buffer[offset] = value ? 1 : 0;
}

function writeWordBE(buffer: Buffer, offset: number, value: number | undefined, max: number): void {
  if (value === undefined) return;
  const clamped = clamp(value, 0, max);
  buffer[offset] = (clamped >> 8) & 0xFF;
  buffer[offset + 1] = clamped & 0xFF;
}

function joyOffset(port: 0 | 1, index: number): number {
  return (port === 0 ? OFFSETS.joy0 : OFFSETS.joy1) + index;
}

export function decodeAutomationInput(buffer: Buffer): AutomationInputState {
  return {
    enabled: buffer[OFFSETS.enabled] !== 0,
    mouseLeft: buffer[OFFSETS.mouseLeft] !== 0,
    mouseRight: buffer[OFFSETS.mouseRight] !== 0,
    mouseX: ((buffer[OFFSETS.mouseXHi] << 8) | buffer[OFFSETS.mouseXLo]) & 0xFFFF,
    mouseY: ((buffer[OFFSETS.mouseYHi] << 8) | buffer[OFFSETS.mouseYLo]) & 0xFFFF,
    joy0: {
      fire: buffer[joyOffset(0, 0)] !== 0,
      up: buffer[joyOffset(0, 1)] !== 0,
      down: buffer[joyOffset(0, 2)] !== 0,
      left: buffer[joyOffset(0, 3)] !== 0,
      right: buffer[joyOffset(0, 4)] !== 0,
    },
    joy1: {
      fire: buffer[joyOffset(1, 0)] !== 0,
      up: buffer[joyOffset(1, 1)] !== 0,
      down: buffer[joyOffset(1, 2)] !== 0,
      left: buffer[joyOffset(1, 3)] !== 0,
      right: buffer[joyOffset(1, 4)] !== 0,
    },
    keycode: buffer[OFFSETS.key] <= 0x7F ? buffer[OFFSETS.key] : null,
  };
}

export function applyAutomationInputPatch(buffer: Buffer, args: Record<string, unknown>): Buffer {
  writeBool(buffer, OFFSETS.enabled, args.enabled as boolean | undefined);
  writeBool(buffer, OFFSETS.mouseLeft, args.mouse_left as boolean | undefined);
  writeBool(buffer, OFFSETS.mouseRight, args.mouse_right as boolean | undefined);
  writeWordBE(buffer, OFFSETS.mouseXHi, args.mouse_x as number | undefined, 319);
  writeWordBE(buffer, OFFSETS.mouseYHi, args.mouse_y as number | undefined, 255);

  writeBool(buffer, joyOffset(0, 0), args.joy0_fire as boolean | undefined);
  writeBool(buffer, joyOffset(0, 1), args.joy0_up as boolean | undefined);
  writeBool(buffer, joyOffset(0, 2), args.joy0_down as boolean | undefined);
  writeBool(buffer, joyOffset(0, 3), args.joy0_left as boolean | undefined);
  writeBool(buffer, joyOffset(0, 4), args.joy0_right as boolean | undefined);

  writeBool(buffer, joyOffset(1, 0), args.joy1_fire as boolean | undefined);
  writeBool(buffer, joyOffset(1, 1), args.joy1_up as boolean | undefined);
  writeBool(buffer, joyOffset(1, 2), args.joy1_down as boolean | undefined);
  writeBool(buffer, joyOffset(1, 3), args.joy1_left as boolean | undefined);
  writeBool(buffer, joyOffset(1, 4), args.joy1_right as boolean | undefined);

  if (args.clear_key === true) {
    buffer[OFFSETS.key] = 0xFF;
  } else if (args.keycode !== undefined && args.keycode !== null) {
    buffer[OFFSETS.key] = clamp(Number(args.keycode), 0, 0x7F);
  }

  return buffer;
}

function parseHexOrDecimal(value: string | number): number {
  if (typeof value === 'number') return value >>> 0;
  const trimmed = value.trim();
  if (trimmed.startsWith('$')) return parseInt(trimmed.slice(1), 16) >>> 0;
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) return parseInt(trimmed.slice(2), 16) >>> 0;
  return parseInt(trimmed, 10) >>> 0;
}

function detectNmExecutable(): string {
  if (process.env.AMIGA_NM_PATH && fs.existsSync(process.env.AMIGA_NM_PATH)) {
    return process.env.AMIGA_NM_PATH;
  }

  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const extensionsDir = path.join(userProfile, '.cursor', 'extensions');
    if (fs.existsSync(extensionsDir)) {
      const matches = fs.readdirSync(extensionsDir)
        .filter((name) => name.startsWith('bartmanabyss.amiga-debug-'))
        .sort()
        .reverse();
      for (const match of matches) {
        const candidate = path.join(
          extensionsDir,
          match,
          'bin',
          'win32',
          'opt',
          'm68k-amiga-elf',
          'bin',
          'nm.exe'
        );
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  throw new Error('Could not locate nm.exe for the Amiga toolchain. Set AMIGA_NM_PATH or install the BartmanAbyss Amiga extension.');
}

export function resolveElfSymbolAddress(elfFile: string, symbolName: string): number {
  const nmExe = detectNmExecutable();
  const output = execFileSync(nmExe, ['-a', elfFile], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const line = output.split(/\r?\n/).find((entry) => entry.trim().endsWith(` ${symbolName}`));
  if (!line) {
    throw new Error(`Symbol ${symbolName} not found in ${elfFile}`);
  }
  const match = line.trim().match(/^([0-9a-fA-F]+)/);
  if (!match) {
    throw new Error(`Could not parse symbol address for ${symbolName}`);
  }
  return parseInt(match[1], 16) >>> 0;
}

export function tryResolveElfSymbolAddress(elfFile: string, symbolName: string): number | null {
  try {
    return resolveElfSymbolAddress(elfFile, symbolName);
  } catch {
    return null;
  }
}

export function resolveAutomationInputSymbolInfo(args: Record<string, unknown>): {
  kind: 'direct' | 'pointer';
  symbolAddress: number;
} {
  if (args.automation_address !== undefined) {
    return {
      kind: 'direct',
      symbolAddress: parseHexOrDecimal(args.automation_address as string | number),
    };
  }
  const elfFile = String(args.elf_file ?? '').trim();
  if (!elfFile) {
    throw new Error('Provide either automation_address or elf_file so the automation buffer can be resolved.');
  }
  const resolvedElf = path.resolve(elfFile);
  const direct = tryResolveElfSymbolAddress(resolvedElf, 'g_automation_input');
  if (direct !== null) {
    return { kind: 'direct', symbolAddress: direct };
  }
  const pointer = tryResolveElfSymbolAddress(resolvedElf, 'g_automation_input_ptr');
  if (pointer !== null) {
    return { kind: 'pointer', symbolAddress: pointer };
  }
  throw new Error(`Could not resolve g_automation_input or g_automation_input_ptr in ${resolvedElf}`);
}

export function resolveEnterDemoAddress(args: Record<string, unknown>): number {
  if (args.enter_demo_address !== undefined) {
    return parseHexOrDecimal(args.enter_demo_address as string | number);
  }
  const elfFile = String(args.elf_file ?? '').trim();
  if (!elfFile) {
    throw new Error('Provide either enter_demo_address or elf_file so g_automation_enter_demo can be resolved.');
  }
  return resolveElfSymbolAddress(path.resolve(elfFile), 'g_automation_enter_demo');
}

export function buildAutomationInputResponse(address: number, buffer: Buffer): Record<string, unknown> {
  return {
    address: '$' + address.toString(16).padStart(8, '0').toUpperCase(),
    raw_hex: buffer.toString('hex').toUpperCase(),
    state: decodeAutomationInput(buffer),
  };
}
