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
    description: 'Load an Amiga executable into memory by writing it via GDB. Provide the host path to the compiled binary.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to Amiga executable on host filesystem',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'winuae_reset',
    description: 'Pause the Amiga CPU and read current register state.',
    inputSchema: {
      type: 'object',
      properties: {},
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
    name: 'winuae_disassemble',
    description: 'Read memory and show as raw 68k words. Note: basic decode only — shows known opcodes (RTS, NOP, etc.) and raw DC.W for others.',
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
];

// ─── Tool Implementations ────────────────────────────────────────────

async function handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: string; text?: string }> }> {
  try {
    switch (name) {
      case 'winuae_connect': {
        if (connection?.connected) {
          return { content: [{ type: 'text', text: 'Already connected to WinUAE' }] };
        }
        connection = new WinUAEConnection(config);
        const statusMsg = await connection.connectSmart();
        return { content: [{ type: 'text', text: statusMsg }] };
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
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const { file } = args;
        const { readFileSync } = await import('fs');
        const { resolve } = await import('path');

        const absPath = resolve(file);
        const fileData = readFileSync(absPath);
        const protocol = connection.getProtocol();

        // Amiga executables (hunk format) start with $000003F3
        // For raw binaries, load at a default address
        let loadAddr = 0x40000; // Default load address in chip RAM
        if (fileData.length >= 4) {
          const magic = fileData.readUInt32BE(0);
          if (magic === 0x000003F3) {
            // Hunk executable — skip hunk header and load code at default address
            // A proper loader would parse hunks, but for simple binaries this works
            console.error(`[WinUAE] Detected hunk executable: ${absPath}`);
          }
        }

        await protocol.writeMemory(loadAddr, fileData);
        return { content: [{ type: 'text', text: `Loaded ${fileData.length} bytes from ${absPath} at ${hex32(loadAddr)}` }] };
      }

      case 'winuae_reset': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        // GDB RSP doesn't have a direct reset command
        // We can try to pause and get registers
        const protocol = connection.getProtocol();
        try {
          await protocol.pause();
        } catch {
          // May already be paused
        }
        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `CPU paused\n${formatRegisters(regs)}` }] };
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
        await protocol.writeMemory(addr, bytes);
        return { content: [{ type: 'text', text: `Wrote ${bytes.length} bytes to ${hex32(addr)}` }] };
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

        const written: string[] = [];
        for (const [regName, rawValue] of Object.entries(args)) {
          if (rawValue === undefined || rawValue === null) continue;
          const idx = REG_INDEX[regName];
          if (idx === undefined) continue;
          const value = parseHexOrDecimal(rawValue as string | number);
          await protocol.writeRegister(idx, value);
          written.push(`${regName}=${hex32(value)}`);
        }

        if (written.length === 0) {
          return { content: [{ type: 'text', text: 'No registers specified to write' }] };
        }

        const regs = await protocol.readRegisters();
        return { content: [{ type: 'text', text: `Set ${written.join(', ')}\n${formatRegisters(regs)}` }] };
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
        return { content: [{ type: 'text', text: 'Execution resumed. Use winuae_pause to stop.' }] };
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

      case 'winuae_disassemble': {
        if (!connection?.connected) throw new Error('Not connected to WinUAE');
        const addr = parseHexOrDecimal(args.address);
        const count = args.count || 20;
        const protocol = connection.getProtocol();
        // Read enough bytes (worst case: 10 bytes per instruction for m68k)
        const data = await protocol.readMemory(addr, count * 2);
        const disasm = disassembleM68k(data, addr, count);
        return { content: [{ type: 'text', text: disasm }] };
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
