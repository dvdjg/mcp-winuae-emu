#!/usr/bin/env node

/**
 * MCP WinUAE Emulator Server
 * Provides Amiga 68k debugging tools via GDB RSP protocol through MCP
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WinUAEConnection, WinUAEConfig } from './winuae-connection.js';
import { M68kRegisters, WatchpointType } from './gdb-protocol.js';
import * as path from 'path';

// ─── Configuration from environment ──────────────────────────────────

const config: WinUAEConfig = {
  winuaePath: process.env.WINUAE_PATH || 'C:\\apps\\winuae',
  configFile: process.env.WINUAE_CONFIG || path.join(
    process.env.WINUAE_PATH || 'C:\\apps\\winuae',
    'Configurations',
    'A500-Dev.uae'
  ),
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

// Global connection instance
let connection: WinUAEConnection | null = null;

// ─── Amiga Custom Register Name Table ────────────────────────────────

const CUSTOM_REGS: Record<number, string> = {
  0x000: 'BLTDDAT', 0x002: 'DMACONR', 0x004: 'VPOSR', 0x006: 'VHPOSR',
  0x008: 'DSKDATR', 0x00A: 'JOY0DAT', 0x00C: 'JOY1DAT', 0x00E: 'CLXDAT',
  0x010: 'ADKCONR', 0x012: 'POT0DAT', 0x014: 'POT1DAT', 0x016: 'POTGOR',
  0x018: 'SERDATR', 0x01A: 'DSKBYTR', 0x01C: 'INTENAR', 0x01E: 'INTREQR',
  0x020: 'DSKPTH', 0x022: 'DSKPTL', 0x024: 'DSKLEN', 0x026: 'DSKDAT',
  0x028: 'REFPTR', 0x02A: 'VPOSW', 0x02C: 'VHPOSW', 0x02E: 'COPCON',
  0x030: 'SERDAT', 0x032: 'SERPER', 0x034: 'POTGO', 0x036: 'JOYTEST',
  0x038: 'STREQU', 0x03A: 'STRVBL', 0x03C: 'STRHOR', 0x03E: 'STRLONG',
  0x040: 'BLTCON0', 0x042: 'BLTCON1', 0x044: 'BLTAFWM', 0x046: 'BLTALWM',
  0x048: 'BLTCPTH', 0x04A: 'BLTCPTL', 0x04C: 'BLTBPTH', 0x04E: 'BLTBPTL',
  0x050: 'BLTAPTH', 0x052: 'BLTAPTL', 0x054: 'BLTDPTH', 0x056: 'BLTDPTL',
  0x058: 'BLTSIZE', 0x05A: 'BLTCON0L', 0x05C: 'BLTSIZV', 0x05E: 'BLTSIZH',
  0x060: 'BLTCMOD', 0x062: 'BLTBMOD', 0x064: 'BLTAMOD', 0x066: 'BLTDMOD',
  0x070: 'BLTCDAT', 0x072: 'BLTBDAT', 0x074: 'BLTADAT',
  0x078: 'SPRHDAT', 0x07C: 'DENISEID',
  0x07E: 'DSKSYNC',
  0x080: 'COP1LCH', 0x082: 'COP1LCL', 0x084: 'COP2LCH', 0x086: 'COP2LCL',
  0x088: 'COPJMP1', 0x08A: 'COPJMP2', 0x08C: 'COPINS',
  0x08E: 'DIWSTRT', 0x090: 'DIWSTOP', 0x092: 'DDFSTRT', 0x094: 'DDFSTOP',
  0x096: 'DMACON', 0x098: 'CLXCON', 0x09A: 'INTENA', 0x09C: 'INTREQ',
  0x09E: 'ADKCON',
  0x0A0: 'AUD0LCH', 0x0A2: 'AUD0LCL', 0x0A4: 'AUD0LEN', 0x0A6: 'AUD0PER',
  0x0A8: 'AUD0VOL', 0x0AA: 'AUD0DAT',
  0x0B0: 'AUD1LCH', 0x0B2: 'AUD1LCL', 0x0B4: 'AUD1LEN', 0x0B6: 'AUD1PER',
  0x0B8: 'AUD1VOL', 0x0BA: 'AUD1DAT',
  0x0C0: 'AUD2LCH', 0x0C2: 'AUD2LCL', 0x0C4: 'AUD2LEN', 0x0C6: 'AUD2PER',
  0x0C8: 'AUD2VOL', 0x0CA: 'AUD2DAT',
  0x0D0: 'AUD3LCH', 0x0D2: 'AUD3LCL', 0x0D4: 'AUD3LEN', 0x0D6: 'AUD3PER',
  0x0D8: 'AUD3VOL', 0x0DA: 'AUD3DAT',
  0x0E0: 'BPL1PTH', 0x0E2: 'BPL1PTL', 0x0E4: 'BPL2PTH', 0x0E6: 'BPL2PTL',
  0x0E8: 'BPL3PTH', 0x0EA: 'BPL3PTL', 0x0EC: 'BPL4PTH', 0x0EE: 'BPL4PTL',
  0x0F0: 'BPL5PTH', 0x0F2: 'BPL5PTL', 0x0F4: 'BPL6PTH', 0x0F6: 'BPL6PTL',
  0x100: 'BPLCON0', 0x102: 'BPLCON1', 0x104: 'BPLCON2', 0x106: 'BPLCON3',
  0x108: 'BPL1MOD', 0x10A: 'BPL2MOD',
  0x110: 'BPL1DAT', 0x112: 'BPL2DAT', 0x114: 'BPL3DAT', 0x116: 'BPL4DAT',
  0x118: 'BPL5DAT', 0x11A: 'BPL6DAT',
  0x120: 'SPR0PTH', 0x122: 'SPR0PTL', 0x124: 'SPR1PTH', 0x126: 'SPR1PTL',
  0x128: 'SPR2PTH', 0x12A: 'SPR2PTL', 0x12C: 'SPR3PTH', 0x12E: 'SPR3PTL',
  0x130: 'SPR4PTH', 0x132: 'SPR4PTL', 0x134: 'SPR5PTH', 0x136: 'SPR5PTL',
  0x138: 'SPR6PTH', 0x13A: 'SPR6PTL', 0x13C: 'SPR7PTH', 0x13E: 'SPR7PTL',
  0x140: 'SPR0POS', 0x142: 'SPR0CTL', 0x144: 'SPR0DATA', 0x146: 'SPR0DATB',
  0x148: 'SPR1POS', 0x14A: 'SPR1CTL', 0x14C: 'SPR1DATA', 0x14E: 'SPR1DATB',
  0x150: 'SPR2POS', 0x152: 'SPR2CTL', 0x154: 'SPR2DATA', 0x156: 'SPR2DATB',
  0x158: 'SPR3POS', 0x15A: 'SPR3CTL', 0x15C: 'SPR3DATA', 0x15E: 'SPR3DATB',
  0x160: 'SPR4POS', 0x162: 'SPR4CTL', 0x164: 'SPR4DATA', 0x166: 'SPR4DATB',
  0x168: 'SPR5POS', 0x16A: 'SPR5CTL', 0x16C: 'SPR5DATA', 0x16E: 'SPR5DATB',
  0x170: 'SPR6POS', 0x172: 'SPR6CTL', 0x174: 'SPR6DATA', 0x176: 'SPR6DATB',
  0x178: 'SPR7POS', 0x17A: 'SPR7CTL', 0x17C: 'SPR7DATA', 0x17E: 'SPR7DATB',
  0x180: 'COLOR00', 0x182: 'COLOR01', 0x184: 'COLOR02', 0x186: 'COLOR03',
  0x188: 'COLOR04', 0x18A: 'COLOR05', 0x18C: 'COLOR06', 0x18E: 'COLOR07',
  0x190: 'COLOR08', 0x192: 'COLOR09', 0x194: 'COLOR10', 0x196: 'COLOR11',
  0x198: 'COLOR12', 0x19A: 'COLOR13', 0x19C: 'COLOR14', 0x19E: 'COLOR15',
  0x1A0: 'COLOR16', 0x1A2: 'COLOR17', 0x1A4: 'COLOR18', 0x1A6: 'COLOR19',
  0x1A8: 'COLOR20', 0x1AA: 'COLOR21', 0x1AC: 'COLOR22', 0x1AE: 'COLOR23',
  0x1B0: 'COLOR24', 0x1B2: 'COLOR25', 0x1B4: 'COLOR26', 0x1B6: 'COLOR27',
  0x1B8: 'COLOR28', 0x1BA: 'COLOR29', 0x1BC: 'COLOR30', 0x1BE: 'COLOR31',
  0x1C0: 'HTOTAL', 0x1C2: 'HSSTOP', 0x1C4: 'HBSTRT', 0x1C6: 'HBSTOP',
  0x1C8: 'VTOTAL', 0x1CA: 'VSSTOP', 0x1CC: 'VBSTRT', 0x1CE: 'VBSTOP',
  0x1DC: 'BEAMCON0', 0x1DE: 'HSSTRT', 0x1E0: 'VSSTRT', 0x1E2: 'HCENTER',
  0x1E4: 'DIWHIGH', 0x1FE: 'NO-OP',
};

// m68k opcode table (first word) for basic disassembly
const M68K_OPCODES: Record<number, string> = {
  0x4E75: 'RTS', 0x4E73: 'RTE', 0x4E71: 'NOP', 0x4E72: 'STOP',
  0x4E70: 'RESET', 0x4AFC: 'ILLEGAL', 0x4E77: 'RTR',
};

// ─── Helper Functions ────────────────────────────────────────────────

function parseHexOrDecimal(value: string | number): number {
  if (typeof value === 'number') return value;
  const s = value.trim();
  let result: number;
  if (s.startsWith('$')) result = parseInt(s.slice(1), 16);
  else if (s.startsWith('0x') || s.startsWith('0X')) result = parseInt(s.slice(2), 16);
  else result = parseInt(s, 10);
  if (isNaN(result)) throw new Error(`Invalid address/value: "${value}"`);
  return result;
}

function hex32(v: number): string {
  return '$' + (v >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function hex16(v: number): string {
  return '$' + (v & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
}

function hex8(v: number): string {
  return '$' + (v & 0xFF).toString(16).padStart(2, '0').toUpperCase();
}

function hexDump(data: Buffer, startAddr: number, bytesPerLine: number = 16): string {
  let result = '';
  for (let i = 0; i < data.length; i += bytesPerLine) {
    const addr = startAddr + i;
    const line = data.subarray(i, Math.min(i + bytesPerLine, data.length));

    result += `$${(addr >>> 0).toString(16).padStart(8, '0').toUpperCase()}  `;

    const hexPart = Array.from(line)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    result += hexPart.padEnd(bytesPerLine * 3, ' ');

    result += ' |';
    for (const byte of line) {
      result += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
    }
    result += '|\n';
  }
  return result;
}

function formatRegisters(regs: M68kRegisters): string {
  const lines: string[] = [];

  // Data registers
  const dRegs = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'] as const;
  lines.push(dRegs.map(r => `${r}=${hex32(regs[r])}`).join(' '));

  // Address registers
  const aRegs = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] as const;
  lines.push(aRegs.map(r => `${r}=${hex32(regs[r])}`).join(' '));

  // SR and PC
  const sr = regs.SR;
  const srFlags = [
    (sr & 0x8000) ? 'T1' : '',
    (sr & 0x4000) ? 'T0' : '',
    (sr & 0x2000) ? 'S' : '',
    (sr & 0x1000) ? 'M' : '',
    `IPL=${(sr >> 8) & 7}`,
    (sr & 0x10) ? 'X' : 'x',
    (sr & 0x08) ? 'N' : 'n',
    (sr & 0x04) ? 'Z' : 'z',
    (sr & 0x02) ? 'V' : 'v',
    (sr & 0x01) ? 'C' : 'c',
  ].filter(s => s).join(' ');

  lines.push(`PC=${hex32(regs.PC)} SR=${hex16(regs.SR)} [${srFlags}]`);

  return lines.join('\n');
}

/**
 * Decode Copper list from raw memory
 */
function decodeCopperList(data: Buffer, baseAddr: number): string {
  const lines: string[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    const addr = baseAddr + i;
    const word1 = data.readUInt16BE(i);
    const word2 = data.readUInt16BE(i + 2);

    const addrStr = `$${(addr >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;

    if (word1 === 0xFFFF && word2 === 0xFFFE) {
      lines.push(`${addrStr}  END`);
      break;
    }

    if (word1 & 1) {
      // WAIT or SKIP instruction
      const vp = (word1 >> 8) & 0xFF;
      const hp = word1 & 0xFE;
      const ve = (word2 >> 8) & 0x7F;
      const he = word2 & 0xFE;
      const bfd = (word2 & 0x8000) ? '' : ' (BFD=0, blitter finish disable)';

      if (word2 & 1) {
        lines.push(`${addrStr}  SKIP  VP>=${hex8(vp)} HP>=${hex8(hp)} VE=${hex8(ve)} HE=${hex8(he)}${bfd}`);
      } else {
        lines.push(`${addrStr}  WAIT  VP>=${hex8(vp)} HP>=${hex8(hp)} VE=${hex8(ve)} HE=${hex8(he)}${bfd}`);
      }
    } else {
      // MOVE instruction
      const regOffset = word1 & 0x1FE;
      const regName = CUSTOM_REGS[regOffset] || `REG_${regOffset.toString(16).padStart(3, '0')}`;
      lines.push(`${addrStr}  MOVE  ${regName} (#${hex16(word2)})`);
    }
  }
  return lines.join('\n');
}

/**
 * Simple m68k disassembly (opcode word only — shows hex for unknown)
 */
function disassembleM68k(data: Buffer, baseAddr: number, count: number): string {
  const lines: string[] = [];
  let offset = 0;
  for (let i = 0; i < count && offset + 1 < data.length; i++) {
    const addr = baseAddr + offset;
    const word = data.readUInt16BE(offset);
    const addrStr = `$${(addr >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
    const wordHex = word.toString(16).padStart(4, '0').toUpperCase();

    const known = M68K_OPCODES[word];
    if (known) {
      lines.push(`${addrStr}  ${wordHex}        ${known}`);
      offset += 2;
    } else {
      // Show raw word — proper disassembly would need a full decoder
      lines.push(`${addrStr}  ${wordHex}        DC.W $${wordHex}`);
      offset += 2;
    }
  }
  return lines.join('\n');
}

// ─── Disk Image Detection ────────────────────────────────────────────

const DISK_IMAGE_EXTENSIONS = new Set(['.adf', '.adz', '.dms', '.ipf', '.fdi', '.scp', '.zip']);

function isDiskImage(filePath: string): boolean {
  return DISK_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Base address of Amiga custom chips */
const CUSTOM_BASE = 0xDFF000;

/** Read 16-bit big-endian word from custom regs buffer at offset (0-0x1FE) */
function readCustomWord(data: Buffer, offset: number): number {
  return data.readUInt16BE(offset);
}

/** Build 24-bit chip RAM address from high and low 16-bit register pair (PTH: bits 7-0, PTL: full 16) */
function chipAddr(high: number, low: number): number {
  return ((high & 0xFF) << 16) | (low & 0xFFFF);
}

/** Custom register name to offset (from $DFF000). Used by winuae_custom_write. */
const CUSTOM_REG_OFFSET: Record<string, number> = {};
for (const [offStr, name] of Object.entries(CUSTOM_REGS)) {
  const off = parseInt(offStr, 10);
  if (!Number.isNaN(off)) CUSTOM_REG_OFFSET[name] = off;
}

// ─── Tool Definitions ────────────────────────────────────────────────

const tools: Tool[] = [
  // Connection tools
  {
    name: 'winuae_connect',
    description: 'Launch WinUAE (BartmanAbyss fork) and connect to GDB RSP server. Must be called before any other WinUAE commands. Set WINUAE_PATH env var to override default path.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_connect_existing',
    description: 'Connect to an already-running WinUAE GDB server (port 2345). Do not start WinUAE. Use when WinUAE was started by F5 or by a script; then use breakpoints/memory/step without calling winuae_load.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_disconnect',
    description: 'Disconnect from WinUAE and stop the emulator process',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_status',
    description: 'Check if WinUAE is running and GDB connection is active',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Load/Reset
  {
    name: 'winuae_load',
    description: 'Load an Amiga executable into memory by writing it via GDB. Provide the host path to the compiled binary. For disk images (ADF, ZIP, ADZ, DMS, IPF), inserts into DF0: and restarts. ADF is the native Amiga disk image format; ZIP files are opened by WinUAE and the first disk image inside is used.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to Amiga executable on host filesystem',
        },
        address: {
          type: ['string', 'number'],
          description: 'Load address in Amiga memory (default: $4000). Use $ prefix for hex.',
          default: 0x4000,
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'winuae_reset',
    description: 'Reset the Amiga by restarting WinUAE with current configuration (hard reset). Reconnects GDB automatically.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Disk tools
  {
    name: 'winuae_insert_disk',
    description: 'Insert a floppy disk image (ADF Amiga Disk File, ADZ, DMS, IPF, ZIP) into a drive. ADF is the standard Amiga format. ZIP: WinUAE uses the first image inside. Use drive 0 for DF0: (boot drive).',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to disk image file (e.g. .adf Amiga Disk File, .zip, .adz, .dms, .ipf)',
        },
        drive: {
          type: 'number',
          description: 'Drive number 0-3 (default: 0 = DF0:)',
          default: 0,
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'winuae_eject_disk',
    description: 'Eject floppy disk from a drive. When connected, uses monitor command (hot-swap, no restart); otherwise clears the drive for next winuae_connect.',
    inputSchema: {
      type: 'object',
      properties: {
        drive: {
          type: 'number',
          description: 'Drive number 0-3 (default: 0 = DF0:)',
          default: 0,
        },
      },
    },
  },

  {
    name: 'winuae_profile',
    description: 'Run frame profiler (same as vscode-amiga-debug): captures N frames of CPU samples, DMA per scanline, custom chip registers, blitter resources, and screenshot per frame. Output is a binary file compatible with vscode-amiga-debug Graphics Debugger / Frame Profiler. Use to analyze CRT scanline flow, blitter ops, and CPU usage autonomously.',
    inputSchema: {
      type: 'object',
      properties: {
        num_frames: {
          type: 'number',
          description: 'Number of frames to capture (1-100, default 1)',
          default: 1,
        },
        out_file: {
          type: 'string',
          description: 'Host path for the profile output file (binary). Default: temp dir with timestamp.',
        },
        unwind_file: {
          type: 'string',
          description: 'Optional path to unwind table for symbol resolution (from linked ELF). Leave empty if not needed.',
        },
      },
    },
  },

  // Memory tools
  {
    name: 'winuae_memory_read',
    description: 'Read memory bytes. Returns hex string. Address can use $ prefix for hex (e.g., $DFF000).',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address (use $ for hex, e.g., $DFF000)',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to read',
        },
      },
      required: ['address', 'length'],
    },
  },
  {
    name: 'winuae_memory_write',
    description: 'Write bytes to memory. Provide data as hex string (e.g., "48E7FFFE" or "48 E7 FF FE").',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address',
        },
        data: {
          type: 'string',
          description: 'Hex data to write',
        },
      },
      required: ['address', 'data'],
    },
  },
  {
    name: 'winuae_memory_dump',
    description: 'Dump memory as formatted hex + ASCII (like a hex editor). Great for inspecting chip registers, copper lists, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to dump',
        },
        bytesPerLine: {
          type: 'number',
          description: 'Bytes per line (default: 16)',
          default: 16,
        },
      },
      required: ['address', 'length'],
    },
  },

  // Register tools
  {
    name: 'winuae_registers_get',
    description: 'Get all m68k CPU registers: D0-D7, A0-A7, SR, PC',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_registers_set',
    description: 'Set m68k CPU registers. Provide any subset of D0-D7, A0-A7, SR, PC.',
    inputSchema: {
      type: 'object',
      properties: {
        D0: { type: ['string', 'number'], description: 'D0 register' },
        D1: { type: ['string', 'number'], description: 'D1 register' },
        D2: { type: ['string', 'number'], description: 'D2 register' },
        D3: { type: ['string', 'number'], description: 'D3 register' },
        D4: { type: ['string', 'number'], description: 'D4 register' },
        D5: { type: ['string', 'number'], description: 'D5 register' },
        D6: { type: ['string', 'number'], description: 'D6 register' },
        D7: { type: ['string', 'number'], description: 'D7 register' },
        A0: { type: ['string', 'number'], description: 'A0 register' },
        A1: { type: ['string', 'number'], description: 'A1 register' },
        A2: { type: ['string', 'number'], description: 'A2 register' },
        A3: { type: ['string', 'number'], description: 'A3 register' },
        A4: { type: ['string', 'number'], description: 'A4 register' },
        A5: { type: ['string', 'number'], description: 'A5 register' },
        A6: { type: ['string', 'number'], description: 'A6 register' },
        A7: { type: ['string', 'number'], description: 'A7 register (SP)' },
        SR: { type: ['string', 'number'], description: 'Status Register' },
        PC: { type: ['string', 'number'], description: 'Program Counter' },
      },
    },
  },

  // Breakpoints
  {
    name: 'winuae_breakpoint_set',
    description: 'Set a software breakpoint at address. Execution stops when PC reaches this address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Address to break at',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'winuae_breakpoint_clear',
    description: 'Remove a breakpoint at address',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Address of breakpoint to remove',
        },
      },
      required: ['address'],
    },
  },

  // Watchpoints
  {
    name: 'winuae_watchpoint_set',
    description: 'Set a watchpoint to break on memory read/write/access.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address of watched range',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to watch',
        },
        type: {
          type: 'string',
          enum: ['read', 'write', 'access'],
          description: 'Type of access to watch for',
        },
      },
      required: ['address', 'length', 'type'],
    },
  },
  {
    name: 'winuae_watchpoint_clear',
    description: 'Remove a watchpoint',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address of watchpoint to remove',
        },
        length: {
          type: 'number',
          description: 'Length of watchpoint to remove',
        },
        type: {
          type: 'string',
          enum: ['read', 'write', 'access'],
          description: 'Type of watchpoint to remove',
        },
      },
      required: ['address', 'length', 'type'],
    },
  },

  // Execution control
  {
    name: 'winuae_step',
    description: 'Single-step N instructions. Returns registers after stepping.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of instructions to step (default: 1)',
          default: 1,
        },
      },
    },
  },
  {
    name: 'winuae_continue',
    description: 'Resume execution. Will stop at next breakpoint/watchpoint.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_pause',
    description: 'Pause/break execution (send interrupt to CPU)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_wait_stop',
    description: 'Wait for execution to stop (e.g. after winuae_continue, when a breakpoint is hit). Call this after winuae_continue so breakpoints actually stop the CPU. Returns stop reason and registers.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: {
          type: 'number',
          description: 'Max ms to wait (default 30000)',
          default: 30000,
        },
      },
    },
  },

  // Amiga hardware tools
  {
    name: 'winuae_custom_registers',
    description: 'Read and decode Amiga custom chip registers ($DFF000-$DFF1FE). Shows register names and values.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_copper_disassemble',
    description: 'Disassemble a Copper list at given address. Decodes WAIT, MOVE, SKIP, and END instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address of copper list',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to read (default: 256)',
          default: 256,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'winuae_gfx_state',
    description: 'Read current Amiga display state from custom registers: BPLCON0 (bitplanes, HIRES), bitplane and sprite pointers, DIW/DDF window, DMACON, color registers, Copper pointer. Use to extract graphics: get bitmap addresses and dimensions, then use winuae_bitmap_read or winuae_memory_read to dump chip RAM.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'winuae_audio_state',
    description: 'Read Paula audio state: for each of 4 channels, sample pointer (AUDxLC), length, period, volume. Optionally include raw sample data from chip RAM (samples_hex=true) for extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        samples_hex: {
          type: 'boolean',
          description: 'If true, read sample data from chip RAM for each channel and return as hex (can be large). Default false.',
          default: false,
        },
      },
    },
  },
  {
    name: 'winuae_bitmap_read',
    description: 'Read raw bitplane data from chip RAM. Give start address (e.g. from winuae_gfx_state BPL1PT), row_bytes (bytes per row per plane), height in rows, and num_planes (1-6). Returns hex of planar data; decode to image externally (e.g. Amiga planar to chunky).',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Chip RAM start address of first bitplane (e.g. from BPL1PTH/L)',
        },
        row_bytes: {
          type: 'number',
          description: 'Bytes per row per bitplane (e.g. 40 for 320px 1bpl)',
        },
        height: {
          type: 'number',
          description: 'Number of rows',
        },
        num_planes: {
          type: 'number',
          description: 'Number of bitplanes (1-6). Total bytes = row_bytes * height * num_planes.',
          default: 1,
        },
      },
      required: ['address', 'row_bytes', 'height'],
    },
  },
  {
    name: 'winuae_memory_search',
    description: 'Search chip or fast RAM for a hex byte pattern (e.g. find Copper lists, graphics, or code signatures). Returns first offset where pattern is found, or -1. Pattern: hex string without spaces (e.g. "01FE0000").',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address to search (e.g. $0 or $40000)',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to search (default 65536). Keep under 256K to avoid timeouts.',
          default: 65536,
        },
        pattern: {
          type: 'string',
          description: 'Hex pattern to find (e.g. 01FE0000 for Copper WAIT). No spaces.',
        },
      },
      required: ['address', 'pattern'],
    },
  },
  {
    name: 'winuae_custom_write',
    description: 'Write a 16-bit value to an Amiga custom register. Use to toggle bitplanes (BPLCON0), DMA (DMACON), or other hardware state for debugging (e.g. disable sprites, hide bitplanes like coppenheimer). Register by name (e.g. BPLCON0, DMACON) or by offset from $DFF000 (e.g. 0x100).',
    inputSchema: {
      type: 'object',
      properties: {
        register: {
          type: 'string',
          description: 'Register name (e.g. BPLCON0, DMACON) or hex offset (e.g. 0x100 for BPLCON0)',
        },
        value: {
          type: ['string', 'number'],
          description: '16-bit value to write (decimal or hex with 0x/$)',
        },
      },
      required: ['register', 'value'],
    },
  },
  {
    name: 'winuae_screenshot',
    description: 'Capture a screenshot of the emulated Amiga display and save to a PNG file. Uses WinUAE GDB monitor command. File path is on the host system.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Full path on host to save the PNG file (e.g., C:\\temp\\screenshot.png)',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'winuae_disassemble_full',
    description: 'Full m68k disassembly at address using WinUAE sm68k disassembler. More accurate than winuae_disassemble.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address (hex with $ or 0x prefix)',
        },
        count: {
          type: 'number',
          description: 'Number of instructions to disassemble (default: 20)',
          default: 20,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'winuae_input_key',
    description: 'Simulate Amiga keyboard: send key press or release by raw scancode (0x00-0x7F). 1=press, 0=release.',
    inputSchema: {
      type: 'object',
      properties: {
        scancode: {
          type: ['string', 'number'],
          description: 'Amiga raw scancode (e.g. 0x45 for Return)',
        },
        state: {
          type: 'number',
          description: '1=press, 0=release (default 1)',
          default: 1,
        },
      },
      required: ['scancode'],
    },
  },
  {
    name: 'winuae_input_event',
    description: 'Send raw WinUAE input event. Event IDs come from config (input.1.keyboard.0.button.N = event ID). Use for precise control.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: {
          type: ['string', 'number'],
          description: 'WinUAE event ID from config',
        },
        state: {
          type: ['string', 'number'],
          description: '1=press, 0=release, 2=toggle (default 1)',
          default: 1,
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'winuae_input_joy',
    description: 'Simulate joystick/gamepad: port 0 or 1, direction/button (left, right, up, down, fire, 2nd, 3rd), state 1=press 0=release.',
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Joystick port: 0=port 1, 1=port 2',
          default: 0,
        },
        action: {
          type: 'string',
          description: 'Direction or button: left, right, up, down, fire, 2nd, 3rd',
          enum: ['left', 'right', 'up', 'down', 'fire', '2nd', '3rd'],
        },
        state: {
          type: 'number',
          description: '1=press, 0=release (default 1)',
          default: 1,
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'winuae_input_mouse',
    description: 'Simulate mouse: move (dx, dy relative), abs (x, y absolute), or button (0=left 1=right 2=middle, 1|0 press|release).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'move=relative delta, abs=absolute position, button=button press/release',
          enum: ['move', 'abs', 'button'],
        },
        dx: { type: 'number', description: 'Delta X for mode=move' },
        dy: { type: 'number', description: 'Delta Y for mode=move' },
        x: { type: 'number', description: 'Absolute X for mode=abs' },
        y: { type: 'number', description: 'Absolute Y for mode=abs' },
        button: { type: 'number', description: '0=left 1=right 2=middle for mode=button' },
        state: { type: 'number', description: '1=press 0=release for mode=button', default: 1 },
      },
      required: ['mode'],
    },
  },
  {
    name: 'winuae_run_program',
    description: 'Load an Amiga executable into memory, set PC to entry, and start execution.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to Amiga executable on host',
        },
        entry: {
          type: ['string', 'number'],
          description: 'Entry address (default: 0x40000)',
          default: '0x40000',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'winuae_disassemble',
    description: 'Read memory and show as raw 68k words. Note: basic decode only — use winuae_disassemble_full for full disassembly.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: ['string', 'number'],
          description: 'Start address',
        },
        count: {
          type: 'number',
          description: 'Number of words to show (default: 20)',
          default: 20,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'winuae_screenshot',
    description: 'Capture current screen buffer and save as PNG file.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Output filename (default: winuae-screen-{timestamp}.png)',
        },
      },
    },
  },
];

// ─── Tool Implementations ────────────────────────────────────────────

async function handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: string; text?: string }> }> {
  try {
    switch (name) {
      case 'winuae_connect': {
        if (connection?.connected) {
          return { content: [{ type: 'text', text: 'Already connected to WinUAE' }] };
        }
        if (!connection) {
          connection = new WinUAEConnection(config);
        }
        const statusMsg = await connection.connectSmart();
        return { content: [{ type: 'text', text: statusMsg }] };
      }

      case 'winuae_connect_existing': {
        if (connection?.connected) {
          return { content: [{ type: 'text', text: 'Already connected to WinUAE' }] };
        }
        if (!connection) {
          connection = new WinUAEConnection(config);
        }
        await connection.connectExisting();
        return { content: [{ type: 'text', text: `Connected to existing WinUAE GDB server on port ${config.gdbPort}. Do not call winuae_load (program already running).` }] };
      }

      case 'winuae_disconnect': {
        if (!connection?.connected) {
          return { content: [{ type: 'text', text: 'Not connected to WinUAE' }] };
        }
        await connection.disconnect();
        connection = null;
        return { content: [{ type: 'text', text: 'Disconnected from WinUAE' }] };
      }

      case 'winuae_status': {
        if (!connection?.connected) {
          return { content: [{ type: 'text', text: 'Not connected' }] };
        }
        const healthy = await connection.healthCheck();
        return { content: [{ type: 'text', text: healthy ? 'Connected and responsive' : 'Connected but not responding' }] };
      }

      case 'winuae_load': {
        const { file } = args;
        const { readFileSync, existsSync } = await import('fs');
        const { resolve } = await import('path');

        const absPath = resolve(file);
        if (!existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }

        // Detect disk images by extension — delegate to disk insertion
        if (isDiskImage(absPath)) {
          if (!connection) {
            connection = new WinUAEConnection(config);
          }
          connection.setFloppy(0, absPath);
          if (connection.connected) {
            const statusMsg = await connection.restart();
            return { content: [{ type: 'text', text: `Detected disk image. Inserted ${absPath} into DF0: and restarted.\n${statusMsg}` }] };
          } else {
            return { content: [{ type: 'text', text: `Detected disk image. ${absPath} set for DF0:. Call winuae_connect to boot.` }] };
          }
        }

        // Load binary into memory via GDB (chunked writes)
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const fileData = readFileSync(absPath);
        const protocol = connection.getProtocol();

        const loadAddr = args.address !== undefined
          ? parseHexOrDecimal(args.address)
          : 0x4000;

        if (fileData.length >= 4) {
          const magic = fileData.readUInt32BE(0);
          if (magic === 0x000003F3) {
            console.error(`[WinUAE] Detected hunk executable: ${absPath}`);
          }
        }

        console.error(`[WinUAE] Loading ${fileData.length} bytes to ${hex32(loadAddr)} (chunked)...`);
        await protocol.writeMemory(loadAddr, fileData);

        // Verify first 16 bytes to confirm write succeeded
        const verifyLen = Math.min(16, fileData.length);
        const readBack = await protocol.readMemory(loadAddr, verifyLen);
        const match = readBack.equals(fileData.subarray(0, verifyLen));
        const verifyMsg = match
          ? 'Verify OK (first 16 bytes match)'
          : `VERIFY MISMATCH! Expected: ${fileData.subarray(0, verifyLen).toString('hex')} Got: ${readBack.toString('hex')}`;

        return { content: [{ type: 'text', text: `Loaded ${fileData.length} bytes from ${absPath} at ${hex32(loadAddr)}\n${verifyMsg}` }] };
      }

      case 'winuae_reset': {
        if (!connection) throw new Error('Not connected to WinUAE');
        // Restart WinUAE entirely — this is a hard reset (power cycle)
        const statusMsg = await connection.restart();
        // After restart, pause and read registers
        const resetProtocol = connection.getProtocol();
        try {
          await resetProtocol.pause();
        } catch {
          // May already be paused after fresh connect
        }
        const regs = await resetProtocol.readRegisters();
        return { content: [{ type: 'text', text: `Reset complete. ${statusMsg}\n${formatRegisters(regs)}` }] };
      }

      case 'winuae_insert_disk': {
        const { file, drive = 0 } = args;
        const { existsSync } = await import('fs');
        const { resolve } = await import('path');

        const absPath = resolve(file);
        if (!existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }

        if (!connection) {
          connection = new WinUAEConnection(config);
        }

        connection.setFloppy(drive, absPath);

        if (connection.connected) {
          const protocol = connection.getProtocol();
          try {
            await protocol.sendMonitorCommand(`df${drive} insert ${absPath}`, 15000);
            return { content: [{ type: 'text', text: `Inserted ${absPath} into DF${drive}: (hot-swap, no restart).` }] };
          } catch {
            const statusMsg = await connection.restart();
            return { content: [{ type: 'text', text: `Inserted ${absPath} into DF${drive}: and restarted.\n${statusMsg}` }] };
          }
        } else {
          return { content: [{ type: 'text', text: `Disk ${absPath} set for DF${drive}:. Will be mounted on next winuae_connect.` }] };
        }
      }

      case 'winuae_eject_disk': {
        const { drive = 0 } = args;

        if (!connection) {
          return { content: [{ type: 'text', text: 'No connection. Nothing to eject.' }] };
        }

        connection.setFloppy(drive, null);

        if (connection.connected) {
          const protocol = connection.getProtocol();
          try {
            await protocol.sendMonitorCommand(`df${drive} eject`, 5000);
            return { content: [{ type: 'text', text: `Ejected DF${drive}: (hot-swap, no restart).` }] };
          } catch {
            const statusMsg = await connection.restart();
            return { content: [{ type: 'text', text: `Ejected DF${drive}: and restarted.\n${statusMsg}` }] };
          }
        } else {
          return { content: [{ type: 'text', text: `DF${drive}: cleared. Will take effect on next winuae_connect.` }] };
        }
      }

      case 'winuae_profile': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const numFrames = Math.max(1, Math.min(100, args.num_frames ?? 1));
        const os = await import('os');
        const { resolve } = await import('path');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const outFile = args.out_file
          ? resolve(args.out_file)
          : resolve(os.tmpdir(), `winuae-profile-${timestamp}.bin`);
        const unwindFile = args.unwind_file ? resolve(args.unwind_file) : '';
        const protocol = connection.getProtocol();
        const cmd = unwindFile
          ? `profile ${numFrames} "${unwindFile}" "${outFile}"`
          : `profile ${numFrames} "" "${outFile}"`;
        const timeoutMs = 60000 + numFrames * 3000;
        const reply = await protocol.sendMonitorCommand(cmd, timeoutMs);
        let decoded: string;
        try {
          if (/^[0-9a-fA-F]+$/.test(reply) && reply.length % 2 === 0) {
            decoded = Buffer.from(reply, 'hex').toString('utf8');
          } else {
            decoded = reply;
          }
        } catch {
          decoded = reply;
        }
        const summary = [
          `Profile: ${numFrames} frame(s) written to: ${outFile}`,
          'Content (same format as vscode-amiga-debug): CPU samples, DMA records per scanline (CRT flow), custom chip registers, AGA colors, blitter/bitmap resources, screenshot per frame (PNG/JPG).',
          'Open the file in vscode-amiga-debug Frame Profiler / Graphics Debugger, or parse the binary format for autonomous analysis.',
        ].join('\n');
        return { content: [{ type: 'text', text: `${decoded}\n${summary}` }] };
      }

      case 'winuae_memory_read': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const { length } = args;
        const protocol = connection.getProtocol();
        const data = await protocol.readMemory(addr, length);
        const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        return { content: [{ type: 'text', text: `Memory ${hex32(addr)}-${hex32(addr + length - 1)}:\n${hexStr}` }] };
      }

      case 'winuae_memory_write': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const bytes = Buffer.from(args.data.replace(/[^0-9A-Fa-f]/g, ''), 'hex');
        const protocol = connection.getProtocol();
        // Many GDB stubs only honour M when halted. Set WINUAE_MEMORY_WRITE_NO_PAUSE=1 to try with CPU running.
        if (process.env.WINUAE_MEMORY_WRITE_NO_PAUSE !== '1') {
          try {
            await protocol.pause();
          } catch {
            // Already paused or pause failed; try write anyway
          }
        }
        await protocol.writeMemory(addr, bytes);
        return { content: [{ type: 'text', text: `Wrote ${bytes.length} bytes to ${hex32(addr)}. CPU is paused; use winuae_continue to resume.` }] };
      }

      case 'winuae_memory_dump': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const { length, bytesPerLine = 16 } = args;
        const protocol = connection.getProtocol();
        const data = await protocol.readMemory(addr, length);
        const dump = hexDump(data, addr, bytesPerLine);
        return { content: [{ type: 'text', text: dump }] };
      }

      case 'winuae_registers_get': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: formatRegisters(regs) }] };
      }

      case 'winuae_registers_set': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();

        // Register name to GDB index mapping
        const REG_INDEX: Record<string, number> = {
          D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
          A0: 8, A1: 9, A2: 10, A3: 11, A4: 12, A5: 13, A6: 14, A7: 15,
          SR: 16, PC: 17,
        };

        const toWrite: Array<{ name: string; idx: number; value: number }> = [];
        for (const [regName, rawValue] of Object.entries(args)) {
          if (rawValue === undefined || rawValue === null) continue;
          const idx = REG_INDEX[regName];
          if (idx === undefined) continue;
          toWrite.push({ name: regName, idx, value: parseHexOrDecimal(rawValue as string | number) });
        }

        if (toWrite.length === 0) {
          return { content: [{ type: 'text', text: 'No registers specified to write' }] };
        }

        // Write one register at a time, verify each before proceeding.
        // The WinUAE GDB server needs time between register writes.
        const results: string[] = [];
        for (const { name, idx, value } of toWrite) {
          await protocol.writeRegister(idx, value);
          // Read back to verify and to drain the GDB server state
          const actual = await protocol.readRegister(idx);
          if (actual !== (value >>> 0)) {
            results.push(`${name}=${hex32(value)} (VERIFY FAILED: got ${hex32(actual)})`);
          } else {
            results.push(`${name}=${hex32(value)}`);
          }
        }

        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `Set ${results.join(', ')}\n${formatRegisters(regs)}` }] };
      }

      case 'winuae_breakpoint_set': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const protocol = connection.getProtocol();
        await protocol.setBreakpoint(addr);
        return { content: [{ type: 'text', text: `Breakpoint set at ${hex32(addr)}` }] };
      }

      case 'winuae_breakpoint_clear': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const protocol = connection.getProtocol();
        await protocol.clearBreakpoint(addr);
        return { content: [{ type: 'text', text: `Breakpoint cleared at ${hex32(addr)}` }] };
      }

      case 'winuae_watchpoint_set': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const { length, type } = args;
        const protocol = connection.getProtocol();
        await protocol.setWatchpoint(addr, length, type as WatchpointType);
        return { content: [{ type: 'text', text: `Watchpoint (${type}) set at ${hex32(addr)}, ${length} bytes` }] };
      }

      case 'winuae_watchpoint_clear': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const { length, type } = args;
        const protocol = connection.getProtocol();
        await protocol.clearWatchpoint(addr, length, type as WatchpointType);
        return { content: [{ type: 'text', text: `Watchpoint (${type}) cleared at ${hex32(addr)}` }] };
      }

      case 'winuae_step': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { count = 1 } = args;
        const protocol = connection.getProtocol();

        for (let i = 0; i < count; i++) {
          await protocol.step();
        }

        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `Stepped ${count} instruction(s)\n${formatRegisters(regs)}` }] };
      }

      case 'winuae_continue': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        await protocol.continue();
        return { content: [{ type: 'text', text: 'Execution resumed. Call winuae_wait_stop to wait for next breakpoint (or winuae_pause to interrupt).' }] };
      }

      case 'winuae_wait_stop': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        const timeoutMs = args.timeout_ms ?? 30000;
        const stopReply = await protocol.waitForStop(timeoutMs);
        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `Stopped (${stopReply})\n${formatRegisters(regs)}` }] };
      }

      case 'winuae_pause': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        const stopReply = await protocol.pause();
        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `Paused (${stopReply})\n${formatRegisters(regs)}` }] };
      }

      case 'winuae_custom_registers': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        // Read in 64-byte chunks; some ranges (ECS/AGA regs on OCS) may fail
        const chunks: Buffer[] = [];
        for (let off = 0; off < 0x200; off += 0x40) {
          try {
            chunks.push(await protocol.readMemory(0xDFF000 + off, 0x40));
          } catch {
            chunks.push(Buffer.alloc(0x40, 0)); // fill unreadable ranges with zeros
          }
        }
        const data = Buffer.concat(chunks);

        const lines: string[] = ['Amiga Custom Registers ($DFF000-$DFF1FE):'];
        for (let offset = 0; offset < 0x200; offset += 2) {
          const name = CUSTOM_REGS[offset];
          if (name) {
            const value = data.readUInt16BE(offset);
            lines.push(`  $DFF${offset.toString(16).padStart(3, '0').toUpperCase()} ${name.padEnd(10)} = ${hex16(value)}`);
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'winuae_copper_disassemble': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const length = args.length || 256;
        const protocol = connection.getProtocol();
        const data = await protocol.readMemory(addr, length);
        const decoded = decodeCopperList(data, addr);
        return { content: [{ type: 'text', text: `Copper list at ${hex32(addr)}:\n${decoded}` }] };
      }

      case 'winuae_gfx_state': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        const chunks: Buffer[] = [];
        for (let off = 0; off < 0x200; off += 0x40) {
          try {
            chunks.push(await protocol.readMemory(CUSTOM_BASE + off, 0x40));
          } catch {
            chunks.push(Buffer.alloc(0x40, 0));
          }
        }
        const d = Buffer.concat(chunks);
        const u16 = (o: number) => readCustomWord(d, o);
        const bplcon0 = u16(0x100);
        const bp = bplcon0 & 7;
        const numPlanes = bp === 0 ? 1 : bp;
        const hires = (bplcon0 & 0x8000) !== 0;
        const ham = (bplcon0 & 0x0800) !== 0;
        const dualPlayfield = (bplcon0 & 0x0400) !== 0;
        const lines: string[] = [
          'Display state (custom registers):',
          `  BPLCON0=${hex16(bplcon0)}  bitplanes=${numPlanes}  HIRES=${hires}  HAM=${ham}  dual PF=${dualPlayfield}`,
          `  DMACON=${hex16(u16(0x096))}  (bit9=sprites bit8=bitplanes bit10=blitter ...)`,
          `  DIWSTRT=${hex16(u16(0x08E))}  DIWSTOP=${hex16(u16(0x090))}  DDFSTRT=${hex16(u16(0x092))}  DDFSTOP=${hex16(u16(0x094))}`,
          '  Bitplane pointers (chip RAM):',
        ];
        for (let i = 1; i <= 6; i++) {
          const addr = chipAddr(u16(0xE0 + (i - 1) * 4), u16(0xE2 + (i - 1) * 4));
          lines.push(`    BPL${i}PTH/L = ${hex32(addr)}`);
        }
        lines.push('  Sprite pointers (chip RAM):');
        for (let i = 0; i < 8; i++) {
          const addr = chipAddr(u16(0x120 + i * 4), u16(0x122 + i * 4));
          lines.push(`    SPR${i}PTH/L = ${hex32(addr)}`);
        }
        lines.push(`  COP1LCH/L = ${hex32(chipAddr(u16(0x080), u16(0x082)))}  (Copper list 1)`);
        lines.push(`  BPL1MOD=${u16(0x108)}  BPL2MOD=${u16(0x10A)}`);
        lines.push('  COLOR00-31 (palette):');
        for (let i = 0; i < 32; i += 8) {
          const vals = Array.from({ length: 8 }, (_, j) => hex16(u16(0x180 + (i + j) * 2)));
          lines.push(`    ${vals.join(' ')}`);
        }
        lines.push('Use winuae_bitmap_read with BPL1 address and row_bytes/height from DIW/DDF to dump bitmap. Use winuae_custom_write BPLCON0/DMACON to toggle bitplanes/sprites.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'winuae_audio_state': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const protocol = connection.getProtocol();
        const chunks: Buffer[] = [];
        for (let off = 0; off < 0x200; off += 0x40) {
          try {
            chunks.push(await protocol.readMemory(CUSTOM_BASE + off, 0x40));
          } catch {
            chunks.push(Buffer.alloc(0x40, 0));
          }
        }
        const d = Buffer.concat(chunks);
        const u16 = (o: number) => readCustomWord(d, o);
        const includeSamples = args.samples_hex === true;
        const lines: string[] = ['Paula audio state (AUD0-AUD3):'];
        for (let ch = 0; ch < 4; ch++) {
          const base = 0xA0 + ch * 0x10;
          const lc = chipAddr(u16(base), u16(base + 2));
          const len = u16(base + 4);
          const per = u16(base + 6);
          const vol = u16(base + 8) & 0x7F;
          lines.push(`  AUD${ch}: LC=${hex32(lc)} LEN=${len} PER=${per} VOL=${vol}`);
          if (includeSamples && lc !== 0 && len > 0) {
            const bytes = Math.min(len * 2, 8192);
            try {
              const samp = await protocol.readMemory(lc, bytes);
              lines.push(`    samples_hex(${bytes} bytes): ${samp.toString('hex').slice(0, 512)}${bytes > 256 ? '...' : ''}`);
            } catch {
              lines.push('    (read failed)');
            }
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'winuae_bitmap_read': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const rowBytes = Number(args.row_bytes);
        const height = Number(args.height);
        const numPlanes = Math.max(1, Math.min(6, Number(args.num_planes) || 1));
        if (rowBytes <= 0 || height <= 0) throw new Error('row_bytes and height must be positive');
        const bytesPerPlane = rowBytes * height;
        const totalBytes = bytesPerPlane * numPlanes;
        if (totalBytes > 256 * 1024) throw new Error('Total bytes too large (max 256KB)');
        const protocol = connection.getProtocol();
        const data = await protocol.readMemory(addr, totalBytes);
        const hex = data.toString('hex');
        const summary = `Read ${totalBytes} bytes planar bitmap at ${hex32(addr)}: ${rowBytes} row_bytes × ${height} rows × ${numPlanes} planes. Decode planar→chunky externally.`;
        return { content: [{ type: 'text', text: `${summary}\nhex: ${hex.slice(0, 2048)}${hex.length > 2048 ? '...' : ''}` }] };
      }

      case 'winuae_memory_search': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const startAddr = parseHexOrDecimal(args.address);
        const maxLen = Math.min(Number(args.length) || 65536, 256 * 1024);
        const patternStr = String(args.pattern).replace(/\s/g, '');
        if (patternStr.length % 2 !== 0) throw new Error('Pattern must have even number of hex digits');
        const pattern = Buffer.from(patternStr, 'hex');
        if (pattern.length === 0) throw new Error('Pattern cannot be empty');
        const protocol = connection.getProtocol();
        const chunkSize = 4096;
        let found = -1;
        for (let off = 0; off < maxLen && found < 0; off += chunkSize) {
          const len = Math.min(chunkSize + pattern.length - 1, maxLen - off);
          const chunk = await protocol.readMemory(startAddr + off, len);
          const idx = chunk.indexOf(pattern);
          if (idx >= 0) {
            found = off + idx;
            break;
          }
        }
        const result = found >= 0 ? `Found at offset ${found} (address ${hex32(startAddr + found)})` : 'Pattern not found';
        return { content: [{ type: 'text', text: result }] };
      }

      case 'winuae_custom_write': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const regStr = String(args.register).toUpperCase();
        const value = parseHexOrDecimal(args.value);
        const val16 = value & 0xFFFF;
        let offset: number;
        if (CUSTOM_REG_OFFSET[regStr] !== undefined) {
          offset = CUSTOM_REG_OFFSET[regStr];
        } else {
          const parsed = parseHexOrDecimal(regStr);
          if (parsed >= 0 && parsed <= 0x1FE) offset = parsed;
          else throw new Error(`Unknown register: ${args.register}. Use name (e.g. BPLCON0) or offset (e.g. 0x100).`);
        }
        const protocol = connection.getProtocol();
        const buf = Buffer.alloc(2);
        buf.writeUInt16BE(val16, 0);
        await protocol.writeMemory(CUSTOM_BASE + offset, buf);
        const name = CUSTOM_REGS[offset] ?? `$DFF${offset.toString(16)}`;
        return { content: [{ type: 'text', text: `Wrote ${hex16(val16)} to ${name} (${hex32(CUSTOM_BASE + offset)})` }] };
      }

      case 'winuae_disassemble': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const count = args.count || 20;
        const protocol = connection.getProtocol();
        const data = await protocol.readMemory(addr, count * 2);
        const disasm = disassembleM68k(data, addr, count);
        return { content: [{ type: 'text', text: disasm }] };
      }

      case 'winuae_screenshot': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { resolve } = await import('path');
        const os = await import('os');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const filename = args.filename ?? args.filepath ?? `winuae-screen-${timestamp}.png`;
        const filepath = path.isAbsolute(filename) ? resolve(filename) : path.join(os.tmpdir(), filename);
        const winPath = filepath.replace(/\//g, '\\');
        const protocol = connection.getProtocol();
        const hexReply = await protocol.sendMonitorCommand(`screenshot ${winPath}`, 15000);
        const textReply = Buffer.from(hexReply, 'hex').toString('utf8');
        return { content: [{ type: 'text', text: `Screenshot saved: ${textReply}\nFile: ${filepath}` }] };
      }

      case 'winuae_disassemble_full': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const count = args.count ?? 20;
        const protocol = connection.getProtocol();
        const hexReply = await protocol.sendMonitorCommand(`disasm ${addr.toString(16)} ${count}`, 10000);
          const textReply = Buffer.from(hexReply, 'hex').toString('utf8');
          return { content: [{ type: 'text', text: textReply }] };
      }

      case 'winuae_run_program': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { file, entry = '0x40000' } = args;
        const { readFileSync, existsSync } = await import('fs');
        const { resolve } = await import('path');
        const absPath = resolve(file);
        if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
        if (isDiskImage(absPath)) throw new Error('Use winuae_insert_disk for disk images');
        const fileData = readFileSync(absPath);
        const entryAddr = parseHexOrDecimal(entry);
        const protocol = connection.getProtocol();
        await protocol.writeMemory(entryAddr, fileData);
        await protocol.writeRegister(17, entryAddr); // PC
        await protocol.continue();
        return { content: [{ type: 'text', text: `Loaded ${fileData.length} bytes at ${hex32(entryAddr)} and started. Call winuae_wait_stop to wait for breakpoint.` }] };
      }

      case 'winuae_input_key': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { scancode, state = 1 } = args;
        const sc = parseHexOrDecimal(scancode);
        const st = state ? 1 : 0;
        const protocol = connection.getProtocol();
        await protocol.sendMonitorCommand(`input key ${sc} ${st}`, 5000);
        return { content: [{ type: 'text', text: `Sent key scancode ${hex8(sc)} ${st ? 'press' : 'release'}` }] };
      }

      case 'winuae_input_event': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { event_id, state = 1 } = args;
        const evt = parseHexOrDecimal(event_id);
        const st = parseHexOrDecimal(state);
        const protocol = connection.getProtocol();
        await protocol.sendMonitorCommand(`input event ${evt} ${st}`, 5000);
        return { content: [{ type: 'text', text: `Sent input event ${evt} state ${st}` }] };
      }

      case 'winuae_input_joy': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { port = 0, action, state = 1 } = args;
        const st = state ? 1 : 0;
        const protocol = connection.getProtocol();
        await protocol.sendMonitorCommand(`input joy ${port} ${action} ${st}`, 5000);
        return { content: [{ type: 'text', text: `Sent joy port ${port} ${action} ${st ? 'press' : 'release'}` }] };
      }

      case 'winuae_input_mouse': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { mode, dx = 0, dy = 0, x = 0, y = 0, button = 0, state = 1 } = args;
        const protocol = connection.getProtocol();
        if (mode === 'move') {
          await protocol.sendMonitorCommand(`input mouse move ${dx} ${dy}`, 5000);
          return { content: [{ type: 'text', text: `Mouse move dx=${dx} dy=${dy}` }] };
        }
        if (mode === 'abs') {
          await protocol.sendMonitorCommand(`input mouse abs ${x} ${y}`, 5000);
          return { content: [{ type: 'text', text: `Mouse abs x=${x} y=${y}` }] };
        }
        if (mode === 'button') {
          const st = state ? 1 : 0;
          await protocol.sendMonitorCommand(`input mouse button ${button} ${st}`, 5000);
          return { content: [{ type: 'text', text: `Mouse button ${button} ${st ? 'press' : 'release'}` }] };
        }
        throw new Error(`Invalid mode: ${mode}`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${errorMessage}` }] };
  }
}

// ─── MCP Server Setup ────────────────────────────────────────────────

const server = new Server(
  {
    name: 'winuae-emu',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args || {});
});

// Handle shutdown
process.on('SIGINT', async () => {
  if (connection?.connected) {
    await connection.disconnect();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (connection?.connected) {
    await connection.disconnect();
  }
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP WinUAE] Server running');
  console.error(`[MCP WinUAE] WinUAE path: ${config.winuaePath}`);
  console.error(`[MCP WinUAE] Config file: ${config.configFile}`);
  console.error(`[MCP WinUAE] GDB port: ${config.gdbPort}`);
}

main().catch((error) => {
  console.error('[MCP WinUAE] Fatal error:', error);
  process.exit(1);
});
