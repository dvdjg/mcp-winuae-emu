#!/usr/bin/env node
/**
 * Script de verificación de MCP-WinUAE-Emu Tools
 * Verifica que todas las herramientas MCP funcionan correctamente con WinUAE-DBG.
 * 
 * Este script simula lo que hace un cliente MCP llamando a las herramientas directamente.
 * Genera evidencias (screenshots, dumps de memoria, logs) para verificación visual.
 * 
 * Uso: node scripts/verify-mcp-tools.mjs
 * 
 * Variables de entorno:
 *   WINUAE_PATH - Ruta al directorio de WinUAE-DBG
 *   WINUAE_CONFIG - Archivo de configuración .uae (default: C:/Amiga/A500-Dev.uae)
 *   WINUAE_GAME_ADF - Juego ADF para pruebas (default: Turrican 3)
 */

import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';
import * as fs from 'fs';

// Configuración
const CONFIG = {
  winuaePath: process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: process.env.WINUAE_CONFIG || 'C:/Amiga/A500-Dev.uae',
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const GAME_ADF = process.env.WINUAE_GAME_ADF || 'C:/Amiga/Turrican 3.adf';
const OUTPUT_DIR = process.env.WINUAE_OUTPUT_DIR || 'C:/Users/dvdjg/Documents/programa/AI/mcp-winuae-emu/test-output';
const EVIDENCE_FILE = path.join(OUTPUT_DIR, 'mcp-verification-report.md');

// Resultados
const results = {
  passed: [],
  failed: [],
  skipped: [],
  evidence: [],
};

// Colores ANSI
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

function log(msg) {
  console.log(`${colors.cyan}[MCP]${colors.reset} ${msg}`);
}

function logTool(tool, status, detail = '') {
  const statusColor = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow;
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`${statusColor}[${status}]${colors.reset} ${colors.magenta}${tool}${colors.reset}${detail ? ` - ${detail}` : ''}`);
  
  if (status === 'PASS') {
    results.passed.push({ tool, detail });
  } else if (status === 'FAIL') {
    results.failed.push({ tool, detail });
  } else {
    results.skipped.push({ tool, detail });
  }
}

function addEvidence(description, filePath) {
  results.evidence.push({ description, filePath });
  log(`Evidencia: ${description} → ${path.basename(filePath)}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseAddress(addr) {
  if (typeof addr === 'string') {
    if (addr.startsWith('$')) return parseInt(addr.slice(1), 16);
    if (addr.startsWith('0x')) return parseInt(addr, 16);
    return parseInt(addr, 10);
  }
  return addr;
}

// Simulación de herramientas MCP
// Estas funciones simulan lo que hace el servidor MCP al recibir las llamadas

async function mcpWinuaeConnect(conn) {
  log('Tool: winuae_connect');
  try {
    conn.setFloppy(0, GAME_ADF);
    await conn.connect();
    logTool('winuae_connect', 'PASS', `Conectado al puerto ${CONFIG.gdbPort}`);
    return true;
  } catch (err) {
    logTool('winuae_connect', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeStatus(conn) {
  log('Tool: winuae_status');
  try {
    const isConnected = conn.connected;
    const healthy = await conn.healthCheck();
    if (isConnected && healthy) {
      logTool('winuae_status', 'PASS', 'Connected and healthy');
      return true;
    }
    throw new Error('Not connected or unhealthy');
  } catch (err) {
    logTool('winuae_status', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeRegistersGet(protocol) {
  log('Tool: winuae_registers_get');
  try {
    const regs = await protocol.readRegisters();
    const summary = `PC=$${regs.PC.toString(16).toUpperCase()}, A7=$${regs.A7.toString(16).toUpperCase()}, SR=$${regs.SR.toString(16).toUpperCase()}`;
    logTool('winuae_registers_get', 'PASS', summary);
    return regs;
  } catch (err) {
    logTool('winuae_registers_get', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeRegistersSet(protocol, originalRegs) {
  log('Tool: winuae_registers_set');
  try {
    const testValue = 0xABCD1234;
    await protocol.writeRegister(0, testValue); // D0
    const verify = await protocol.readRegisters();
    if (verify.D0 !== testValue) throw new Error('Verification failed');
    await protocol.writeRegister(0, originalRegs.D0); // Restore
    logTool('winuae_registers_set', 'PASS', `D0 escrito y restaurado`);
    return true;
  } catch (err) {
    logTool('winuae_registers_set', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeMemoryRead(protocol) {
  log('Tool: winuae_memory_read');
  try {
    const mem = await protocol.readMemory(0x100, 32);
    const hex = mem.toString('hex').toUpperCase();
    logTool('winuae_memory_read', 'PASS', `$0100: ${hex.slice(0, 32)}...`);
    return mem;
  } catch (err) {
    logTool('winuae_memory_read', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeMemoryWrite(protocol) {
  log('Tool: winuae_memory_write');
  try {
    const addr = 0x2000;
    const testData = Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]);
    const original = await protocol.readMemory(addr, 4);
    await protocol.writeMemory(addr, testData);
    const verify = await protocol.readMemory(addr, 4);
    if (!verify.equals(testData)) throw new Error('Verification failed');
    await protocol.writeMemory(addr, original);
    logTool('winuae_memory_write', 'PASS', `$${addr.toString(16)}: CAFEBABE`);
    return true;
  } catch (err) {
    logTool('winuae_memory_write', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeMemoryDump(protocol, outputDir) {
  log('Tool: winuae_memory_dump');
  try {
    const addr = 0xDFF000;
    const len = 256;
    const mem = await protocol.readMemory(addr, len);
    
    // Crear dump en formato hex editor
    let dump = `Memory dump: $${addr.toString(16).toUpperCase()} - $${(addr + len - 1).toString(16).toUpperCase()}\n`;
    dump += '─'.repeat(70) + '\n';
    for (let i = 0; i < mem.length; i += 16) {
      const addrStr = (addr + i).toString(16).toUpperCase().padStart(8, '0');
      let hexPart = '';
      let asciiPart = '';
      for (let j = 0; j < 16 && i + j < mem.length; j++) {
        const b = mem[i + j];
        hexPart += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
        asciiPart += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      }
      dump += `${addrStr}: ${hexPart.padEnd(48)} ${asciiPart}\n`;
    }
    
    const dumpFile = path.join(outputDir, 'custom-registers-dump.txt');
    fs.writeFileSync(dumpFile, dump);
    addEvidence('Custom registers dump ($DFF000)', dumpFile);
    logTool('winuae_memory_dump', 'PASS', `Dumped ${len} bytes to ${path.basename(dumpFile)}`);
    return true;
  } catch (err) {
    logTool('winuae_memory_dump', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeCustomRegisters(protocol, outputDir) {
  log('Tool: winuae_custom_registers');
  try {
    const mem = await protocol.readMemory(0xDFF000, 0x200);
    
    // Decodificar algunos registros conocidos
    const regs = {
      DMACONR: (mem[0x02] << 8) | mem[0x03],
      VPOSR: (mem[0x04] << 8) | mem[0x05],
      VHPOSR: (mem[0x06] << 8) | mem[0x07],
      DSKDATR: (mem[0x08] << 8) | mem[0x09],
      JOY0DAT: (mem[0x0A] << 8) | mem[0x0B],
      JOY1DAT: (mem[0x0C] << 8) | mem[0x0D],
      INTENAR: (mem[0x1C] << 8) | mem[0x1D],
      INTREQR: (mem[0x1E] << 8) | mem[0x1F],
      BPLCON0: (mem[0x100] << 8) | mem[0x101],
      BPLCON1: (mem[0x102] << 8) | mem[0x103],
      BPLCON2: (mem[0x104] << 8) | mem[0x105],
      BPL1MOD: (mem[0x108] << 8) | mem[0x109],
      BPL2MOD: (mem[0x10A] << 8) | mem[0x10B],
    };
    
    let output = 'Custom Chip Registers ($DFF000)\n';
    output += '═'.repeat(50) + '\n';
    for (const [name, value] of Object.entries(regs)) {
      output += `${name.padEnd(12)}: $${value.toString(16).toUpperCase().padStart(4, '0')}\n`;
    }
    
    const regFile = path.join(outputDir, 'custom-registers.txt');
    fs.writeFileSync(regFile, output);
    addEvidence('Custom registers decoded', regFile);
    logTool('winuae_custom_registers', 'PASS', `BPLCON0=$${regs.BPLCON0.toString(16)}, VPOSR=$${regs.VPOSR.toString(16)}`);
    return regs;
  } catch (err) {
    logTool('winuae_custom_registers', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeBreakpointSet(protocol) {
  log('Tool: winuae_breakpoint_set');
  try {
    const addr = 0xFC00A0;
    await protocol.setBreakpoint(addr);
    logTool('winuae_breakpoint_set', 'PASS', `$${addr.toString(16).toUpperCase()}`);
    return addr;
  } catch (err) {
    logTool('winuae_breakpoint_set', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeBreakpointClear(protocol, addr) {
  log('Tool: winuae_breakpoint_clear');
  try {
    await protocol.clearBreakpoint(addr);
    logTool('winuae_breakpoint_clear', 'PASS', `$${addr.toString(16).toUpperCase()}`);
    return true;
  } catch (err) {
    logTool('winuae_breakpoint_clear', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeWatchpointSet(protocol) {
  log('Tool: winuae_watchpoint_set');
  try {
    const addr = 0x1000;
    const len = 4;
    await protocol.setWatchpoint(addr, len, 'write');
    logTool('winuae_watchpoint_set', 'PASS', `$${addr.toString(16)}, len=${len}, type=write`);
    return { addr, len };
  } catch (err) {
    logTool('winuae_watchpoint_set', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeWatchpointClear(protocol, wp) {
  log('Tool: winuae_watchpoint_clear');
  try {
    await protocol.clearWatchpoint(wp.addr, wp.len, 'write');
    logTool('winuae_watchpoint_clear', 'PASS', `$${wp.addr.toString(16)}`);
    return true;
  } catch (err) {
    logTool('winuae_watchpoint_clear', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeStep(protocol) {
  log('Tool: winuae_step');
  try {
    const before = await protocol.readRegisters();
    await protocol.step();
    const after = await protocol.readRegisters();
    logTool('winuae_step', 'PASS', `PC: $${before.PC.toString(16)} → $${after.PC.toString(16)}`);
    return true;
  } catch (err) {
    logTool('winuae_step', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeContinue(protocol) {
  log('Tool: winuae_continue');
  try {
    await protocol.continue();
    logTool('winuae_continue', 'PASS', 'Ejecución reanudada');
    return true;
  } catch (err) {
    logTool('winuae_continue', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaePause(protocol) {
  log('Tool: winuae_pause');
  try {
    const reply = await protocol.pause();
    logTool('winuae_pause', 'PASS', `Stop reply: ${reply}`);
    return true;
  } catch (err) {
    logTool('winuae_pause', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeScreenshot(protocol, outputDir, filename) {
  log('Tool: winuae_screenshot');
  try {
    const filePath = path.join(outputDir, filename).replace(/\//g, '\\');
    await protocol.sendMonitorCommand(`screenshot ${filePath}`, 15000);
    await sleep(500);
    
    if (!fs.existsSync(filePath)) {
      throw new Error('Screenshot file not created');
    }
    
    const stats = fs.statSync(filePath);
    addEvidence(`Screenshot: ${filename}`, filePath);
    logTool('winuae_screenshot', 'PASS', `${filename} (${stats.size} bytes)`);
    return filePath;
  } catch (err) {
    logTool('winuae_screenshot', 'FAIL', err.message);
    return null;
  }
}

async function mcpWinuaeDisassembleFull(protocol, outputDir) {
  log('Tool: winuae_disassemble_full');
  try {
    const regs = await protocol.readRegisters();
    const reply = await protocol.sendMonitorCommand(`disasm ${regs.PC.toString(16)} 20`, 10000);
    const decoded = Buffer.from(reply, 'hex').toString('utf8');
    
    const disasmFile = path.join(outputDir, 'disassembly.txt');
    fs.writeFileSync(disasmFile, `Disassembly at PC=$${regs.PC.toString(16).toUpperCase()}\n${'═'.repeat(60)}\n${decoded}`);
    addEvidence('Disassembly at PC', disasmFile);
    
    const firstLine = decoded.split('\n')[0];
    logTool('winuae_disassemble_full', 'PASS', firstLine.slice(0, 50));
    return true;
  } catch (err) {
    logTool('winuae_disassemble_full', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeCopperDisassemble(protocol, outputDir) {
  log('Tool: winuae_copper_disassemble');
  try {
    // Leer puntero del Copper desde custom registers
    const mem = await protocol.readMemory(0xDFF080, 4); // COP1LCH/COP1LCL
    const cop1lc = (mem[0] << 24) | (mem[1] << 16) | (mem[2] << 8) | mem[3];
    
    if (cop1lc === 0) {
      logTool('winuae_copper_disassemble', 'SKIP', 'COP1LC is 0 (no copper list active)');
      return null;
    }
    
    // Leer y decodificar copper list
    const copperMem = await protocol.readMemory(cop1lc, 256);
    let copperDis = `Copper List at $${cop1lc.toString(16).toUpperCase()}\n${'═'.repeat(60)}\n`;
    
    for (let i = 0; i < copperMem.length - 3; i += 4) {
      const ir1 = (copperMem[i] << 8) | copperMem[i + 1];
      const ir2 = (copperMem[i + 2] << 8) | copperMem[i + 3];
      const addr = cop1lc + i;
      
      if ((ir1 & 1) === 0) {
        // MOVE
        const reg = ir1 & 0x1FE;
        copperDis += `$${addr.toString(16).padStart(6, '0')}: MOVE $${ir2.toString(16).padStart(4, '0')} → $DFF${reg.toString(16).padStart(3, '0')}\n`;
      } else if ((ir2 & 1) === 0) {
        // WAIT
        const vp = (ir1 >> 8) & 0xFF;
        const hp = ir1 & 0xFE;
        const vm = (ir2 >> 8) & 0x7F;
        const hm = ir2 & 0xFE;
        copperDis += `$${addr.toString(16).padStart(6, '0')}: WAIT VP=$${vp.toString(16)}, HP=$${hp.toString(16)} (mask=$${vm.toString(16)},$${hm.toString(16)})\n`;
        if (ir1 === 0xFFFF && ir2 === 0xFFFE) {
          copperDis += '                END\n';
          break;
        }
      } else {
        // SKIP
        copperDis += `$${addr.toString(16).padStart(6, '0')}: SKIP\n`;
      }
    }
    
    const copperFile = path.join(outputDir, 'copper-list.txt');
    fs.writeFileSync(copperFile, copperDis);
    addEvidence('Copper list disassembly', copperFile);
    logTool('winuae_copper_disassemble', 'PASS', `COP1LC=$${cop1lc.toString(16)}`);
    return true;
  } catch (err) {
    logTool('winuae_copper_disassemble', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeInputKey(protocol) {
  log('Tool: winuae_input_key');
  try {
    // Space key press/release
    await protocol.sendMonitorCommand('input key 0x40 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input key 0x40 0', 5000);
    logTool('winuae_input_key', 'PASS', 'Space (0x40)');
    return true;
  } catch (err) {
    logTool('winuae_input_key', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeInputJoy(protocol) {
  log('Tool: winuae_input_joy');
  try {
    // Up + Fire
    await protocol.sendMonitorCommand('input joy 0 up 1', 5000);
    await sleep(50);
    await protocol.sendMonitorCommand('input joy 0 fire 1', 5000);
    await sleep(150);
    await protocol.sendMonitorCommand('input joy 0 fire 0', 5000);
    await protocol.sendMonitorCommand('input joy 0 up 0', 5000);
    logTool('winuae_input_joy', 'PASS', 'Port 0: Up + Fire');
    return true;
  } catch (err) {
    logTool('winuae_input_joy', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeInputMouse(protocol) {
  log('Tool: winuae_input_mouse');
  try {
    await protocol.sendMonitorCommand('input mouse move 20 10', 5000);
    await protocol.sendMonitorCommand('input mouse button 0 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input mouse button 0 0', 5000);
    logTool('winuae_input_mouse', 'PASS', 'Move + Left click');
    return true;
  } catch (err) {
    logTool('winuae_input_mouse', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeInsertDisk(protocol) {
  log('Tool: winuae_insert_disk');
  try {
    const adfPath = GAME_ADF.replace(/\//g, '\\');
    await protocol.sendMonitorCommand(`df0 insert ${adfPath}`, 10000);
    logTool('winuae_insert_disk', 'PASS', path.basename(GAME_ADF));
    return true;
  } catch (err) {
    logTool('winuae_insert_disk', 'FAIL', err.message);
    return false;
  }
}

async function mcpWinuaeEjectDisk(protocol) {
  log('Tool: winuae_eject_disk');
  try {
    await protocol.sendMonitorCommand('df0 eject', 10000);
    logTool('winuae_eject_disk', 'PASS', 'DF0:');
    return true;
  } catch (err) {
    logTool('winuae_eject_disk', 'FAIL', err.message);
    return false;
  }
}

// Generar reporte de evidencias
function generateEvidenceReport() {
  let report = `# Reporte de Verificación MCP-WinUAE-Emu\n\n`;
  report += `**Fecha:** ${new Date().toISOString()}\n\n`;
  report += `**Configuración:**\n`;
  report += `- WinUAE Path: \`${CONFIG.winuaePath}\`\n`;
  report += `- Config File: \`${CONFIG.configFile}\`\n`;
  report += `- Juego: \`${GAME_ADF}\`\n\n`;
  
  report += `## Resumen\n\n`;
  report += `| Resultado | Cantidad |\n`;
  report += `|-----------|----------|\n`;
  report += `| Pasados   | ${results.passed.length} |\n`;
  report += `| Fallidos  | ${results.failed.length} |\n`;
  report += `| Omitidos  | ${results.skipped.length} |\n\n`;
  
  report += `## Tests Pasados\n\n`;
  for (const r of results.passed) {
    report += `- **${r.tool}**: ${r.detail || 'OK'}\n`;
  }
  
  if (results.failed.length > 0) {
    report += `\n## Tests Fallidos\n\n`;
    for (const r of results.failed) {
      report += `- **${r.tool}**: ${r.detail}\n`;
    }
  }
  
  if (results.skipped.length > 0) {
    report += `\n## Tests Omitidos\n\n`;
    for (const r of results.skipped) {
      report += `- **${r.tool}**: ${r.detail}\n`;
    }
  }
  
  report += `\n## Evidencias Generadas\n\n`;
  for (const e of results.evidence) {
    report += `- **${e.description}**: \`${path.basename(e.filePath)}\`\n`;
  }
  
  report += `\n---\n*Generado por verify-mcp-tools.mjs*\n`;
  
  return report;
}

// Main
async function main() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     VERIFICACIÓN DE MCP-WinUAE-Emu Tools');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${colors.reset}`);
  
  // Verificar archivos necesarios
  log(`WinUAE Path: ${CONFIG.winuaePath}`);
  log(`Config File: ${CONFIG.configFile}`);
  log(`Game ADF: ${GAME_ADF}`);
  log(`Output Dir: ${OUTPUT_DIR}`);
  console.log('');
  
  if (!fs.existsSync(GAME_ADF)) {
    console.error(`${colors.red}ERROR: Game ADF not found: ${GAME_ADF}${colors.reset}`);
    process.exit(1);
  }
  
  // Crear directorio de salida
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Configurar delays
  process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '8000';
  
  const conn = new WinUAEConnection(CONFIG);
  let protocol = null;
  
  try {
    // Test 1: winuae_connect
    console.log(`\n${colors.bold}--- Fase 1: Conexión ---${colors.reset}`);
    const connected = await mcpWinuaeConnect(conn);
    if (!connected) {
      throw new Error('Cannot continue without connection');
    }
    
    log('Esperando 15s para que arranque el juego...');
    await sleep(15000);
    
    protocol = conn.getProtocol();
    
    // Test 2: winuae_status
    await mcpWinuaeStatus(conn);
    
    // Screenshot inicial
    console.log(`\n${colors.bold}--- Fase 2: Screenshot Inicial ---${colors.reset}`);
    await mcpWinuaeScreenshot(protocol, OUTPUT_DIR, 'screenshot-01-initial.png');
    
    // Tests de registros
    console.log(`\n${colors.bold}--- Fase 3: Registros CPU ---${colors.reset}`);
    const regs = await mcpWinuaeRegistersGet(protocol);
    if (regs) {
      await mcpWinuaeRegistersSet(protocol, regs);
    }
    
    // Tests de memoria
    console.log(`\n${colors.bold}--- Fase 4: Memoria ---${colors.reset}`);
    await mcpWinuaeMemoryRead(protocol);
    await mcpWinuaeMemoryWrite(protocol);
    await mcpWinuaeMemoryDump(protocol, OUTPUT_DIR);
    
    // Tests de custom registers
    console.log(`\n${colors.bold}--- Fase 5: Custom Registers ---${colors.reset}`);
    await mcpWinuaeCustomRegisters(protocol, OUTPUT_DIR);
    
    // Tests de breakpoints
    console.log(`\n${colors.bold}--- Fase 6: Breakpoints ---${colors.reset}`);
    const bpAddr = await mcpWinuaeBreakpointSet(protocol);
    if (bpAddr) {
      await mcpWinuaeBreakpointClear(protocol, bpAddr);
    }
    
    // Tests de watchpoints
    console.log(`\n${colors.bold}--- Fase 7: Watchpoints ---${colors.reset}`);
    const wp = await mcpWinuaeWatchpointSet(protocol);
    if (wp) {
      await mcpWinuaeWatchpointClear(protocol, wp);
    }
    
    // Tests de control de ejecución
    console.log(`\n${colors.bold}--- Fase 8: Control de Ejecución ---${colors.reset}`);
    await mcpWinuaeStep(protocol);
    await mcpWinuaeContinue(protocol);
    await sleep(1000);
    await mcpWinuaePause(protocol);
    
    // Tests de desensamblado
    console.log(`\n${colors.bold}--- Fase 9: Desensamblado ---${colors.reset}`);
    await mcpWinuaeDisassembleFull(protocol, OUTPUT_DIR);
    await mcpWinuaeCopperDisassemble(protocol, OUTPUT_DIR);
    
    // Tests de input
    console.log(`\n${colors.bold}--- Fase 10: Input ---${colors.reset}`);
    await mcpWinuaeContinue(protocol);
    await sleep(500);
    await mcpWinuaeInputKey(protocol);
    await sleep(300);
    await mcpWinuaeInputJoy(protocol);
    await sleep(300);
    await mcpWinuaeInputMouse(protocol);
    await sleep(500);
    
    // Screenshot después de inputs
    await mcpWinuaePause(protocol);
    await mcpWinuaeScreenshot(protocol, OUTPUT_DIR, 'screenshot-02-after-input.png');
    
    // Tests de disco
    console.log(`\n${colors.bold}--- Fase 11: Operaciones de Disco ---${colors.reset}`);
    await mcpWinuaeEjectDisk(protocol);
    await sleep(500);
    await mcpWinuaeInsertDisk(protocol);
    
    // Screenshot final
    console.log(`\n${colors.bold}--- Fase 12: Screenshot Final ---${colors.reset}`);
    await mcpWinuaeContinue(protocol);
    await sleep(3000);
    await mcpWinuaePause(protocol);
    await mcpWinuaeScreenshot(protocol, OUTPUT_DIR, 'screenshot-03-final.png');
    
  } catch (err) {
    console.error(`${colors.red}ERROR CRÍTICO: ${err.message}${colors.reset}`);
    results.failed.push({ tool: 'Ejecución general', detail: err.message });
  } finally {
    log('Desconectando...');
    await conn.disconnect();
  }
  
  // Generar reporte
  const report = generateEvidenceReport();
  fs.writeFileSync(EVIDENCE_FILE, report);
  addEvidence('Reporte de verificación', EVIDENCE_FILE);
  
  // Resumen
  console.log('');
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    RESUMEN DE RESULTADOS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${colors.reset}`);
  
  console.log(`${colors.green}PASADOS: ${results.passed.length}${colors.reset}`);
  for (const r of results.passed) {
    console.log(`  ✓ ${r.tool}`);
  }
  
  if (results.failed.length > 0) {
    console.log(`\n${colors.red}FALLIDOS: ${results.failed.length}${colors.reset}`);
    for (const r of results.failed) {
      console.log(`  ✗ ${r.tool}: ${r.detail}`);
    }
  }
  
  if (results.skipped.length > 0) {
    console.log(`\n${colors.yellow}OMITIDOS: ${results.skipped.length}${colors.reset}`);
    for (const r of results.skipped) {
      console.log(`  ○ ${r.tool}: ${r.detail}`);
    }
  }
  
  console.log(`\n${colors.cyan}EVIDENCIAS:${colors.reset}`);
  for (const e of results.evidence) {
    console.log(`  📁 ${e.description}: ${path.basename(e.filePath)}`);
  }
  
  console.log('');
  const total = results.passed.length + results.failed.length + results.skipped.length;
  const pct = Math.round((results.passed.length / total) * 100);
  console.log(`Total: ${results.passed.length}/${total} tools verificadas (${pct}%)`);
  console.log(`Reporte: ${EVIDENCE_FILE}`);
  
  if (results.failed.length > 0) {
    console.log(`\n${colors.red}⚠ Hay ${results.failed.length} tool(s) fallida(s)${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}✓ Todas las tools funcionan correctamente${colors.reset}`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`${colors.red}Error fatal: ${err.message}${colors.reset}`);
  process.exit(1);
});
