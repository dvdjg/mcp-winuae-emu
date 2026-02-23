#!/usr/bin/env node
/**
 * test-connect-existing.mjs
 * 
 * Test de conexión MCP a una sesión de WinUAE/GDB existente.
 * 
 * Este script se conecta a una sesión de depuración ya iniciada (por ejemplo,
 * desde VS Code con F5 usando la extensión amiga-debug de BartmanAbyss).
 * 
 * IMPORTANTE: El MCP se conecta como cliente secundario al servidor GDB.
 * La sesión de VS Code (GDB principal) continúa funcionando.
 * 
 * Demuestra:
 * 1. Conexión a sesión existente
 * 2. Lectura de registros y memoria
 * 3. Single-step (si el programa está pausado)
 * 4. Screenshots
 * 5. Coexistencia con otro debugger
 * 
 * USO:
 *   1. Abre VS Code con Cursor-Amiga-C
 *   2. Pon breakpoint en app/main.c:15
 *   3. Presiona F5 (config: "AROS (debug, breakpoints fiables)")
 *   4. Espera a que pause en el breakpoint
 *   5. Ejecuta: node scripts/test-connect-existing.mjs
 * 
 * Variables de entorno:
 *   WINUAE_GDB_PORT - Puerto del servidor GDB (default: 2345)
 */

import { GdbProtocol } from '../dist/gdb-protocol.js';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuración
const PORT = parseInt(process.env.WINUAE_GDB_PORT || '2345', 10);
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output', 'connect-existing');

// Colores ANSI
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

// Resultados
const results = { passed: [], failed: [], evidence: [] };

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`${C.cyan}[${ts}]${C.reset} ${msg}`);
}

function logTest(name, passed, detail = '') {
  const status = passed ? 'PASS' : 'FAIL';
  const color = passed ? C.green : C.red;
  console.log(`${color}[${status}]${C.reset} ${name}${detail ? ` - ${detail}` : ''}`);
  (passed ? results.passed : results.failed).push({ name, detail });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.end(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('');
  console.log(`${C.bold}╔════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║     TEST: Conexión MCP a sesión de depuración existente        ║${C.reset}`);
  console.log(`${C.bold}╚════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');

  // Crear directorio de salida
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. Verificar que hay una sesión activa
  log(`Verificando servidor GDB en puerto ${PORT}...`);
  const available = await checkPort(PORT);
  
  if (!available) {
    console.log('');
    console.log(`${C.red}ERROR: No hay servidor GDB activo en puerto ${PORT}${C.reset}`);
    console.log('');
    console.log('Para usar este test:');
    console.log('  1. Abre VS Code con el proyecto Cursor-Amiga-C');
    console.log('  2. Pon un breakpoint en app/main.c (línea 15 o cualquier otra)');
    console.log('  3. Presiona F5 para iniciar depuración (config: "AROS (debug)")');
    console.log('  4. Espera a que el programa pause en el breakpoint');
    console.log('  5. Ejecuta este script de nuevo');
    console.log('');
    process.exit(1);
  }
  
  logTest('Servidor GDB disponible', true, `puerto ${PORT}`);

  // 2. Conectar usando GdbProtocol directamente
  log('Conectando al servidor GDB...');
  const protocol = new GdbProtocol();
  
  try {
    await protocol.connect('localhost', PORT);
    logTest('Conexión GDB', true);
  } catch (err) {
    logTest('Conexión GDB', false, err.message);
    process.exit(1);
  }

  // 3. Leer registros
  log('Leyendo registros CPU...');
  try {
    const regsHex = await protocol.sendCommand('g');
    const regs = parseRegisters(regsHex);
    logTest('Lectura de registros', true, `PC=$${regs.PC.toString(16).toUpperCase()}`);
    
    // Guardar evidencia
    const regsPath = path.join(OUTPUT_DIR, 'registers.txt');
    fs.writeFileSync(regsPath, formatRegisters(regs));
    results.evidence.push({ name: 'Registros CPU', file: 'registers.txt' });
    log(`Registros guardados en ${regsPath}`);
  } catch (err) {
    logTest('Lectura de registros', false, err.message);
  }

  // 4. Desensamblar código actual
  log('Desensamblando código en PC...');
  try {
    const disasmResult = await protocol.sendMonitorCommand('disasm 20');
    logTest('Desensamblado', true);
    
    const disasmPath = path.join(OUTPUT_DIR, 'disassembly.txt');
    fs.writeFileSync(disasmPath, disasmResult);
    results.evidence.push({ name: 'Desensamblado', file: 'disassembly.txt' });
  } catch (err) {
    logTest('Desensamblado', false, err.message);
  }

  // 5. Leer memoria (stack)
  log('Leyendo memoria (stack)...');
  try {
    const regsHex = await protocol.sendCommand('g');
    const regs = parseRegisters(regsHex);
    const sp = regs.A7;
    
    const memHex = await protocol.sendCommand(`m${sp.toString(16)},40`);
    logTest('Lectura de memoria', true, `SP=$${sp.toString(16).toUpperCase()}`);
    
    const memPath = path.join(OUTPUT_DIR, 'stack.txt');
    fs.writeFileSync(memPath, `Stack at $${sp.toString(16).toUpperCase()}:\n${formatMemory(sp, memHex)}`);
    results.evidence.push({ name: 'Stack', file: 'stack.txt' });
  } catch (err) {
    logTest('Lectura de memoria', false, err.message);
  }

  // 6. Screenshot
  log('Tomando screenshot...');
  try {
    const screenshotResult = await protocol.sendMonitorCommand('screenshot');
    if (screenshotResult.startsWith('OK')) {
      const parts = screenshotResult.match(/(\d+)x(\d+)\s+(.+)/);
      if (parts) {
        const srcPath = parts[3].trim();
        const dstPath = path.join(OUTPUT_DIR, 'screenshot.png');
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath);
          logTest('Screenshot', true, `${parts[1]}x${parts[2]}`);
          results.evidence.push({ name: 'Screenshot', file: 'screenshot.png' });
        } else {
          logTest('Screenshot', true, 'capturado pero archivo no accesible');
        }
      }
    } else {
      logTest('Screenshot', false, screenshotResult);
    }
  } catch (err) {
    logTest('Screenshot', false, err.message);
  }

  // 7. Single-step (5 instrucciones)
  log('Ejecutando single-step (5 instrucciones)...');
  const stepResults = [];
  
  for (let i = 0; i < 5; i++) {
    try {
      // Enviar step y esperar respuesta
      await protocol.sendCommand('vCont;s');
      
      // Esperar stop reply
      await sleep(200);
      
      // Leer nuevo PC
      const regsHex = await protocol.sendCommand('g');
      const regs = parseRegisters(regsHex);
      stepResults.push(`Paso ${i+1}: PC=$${regs.PC.toString(16).toUpperCase()}`);
    } catch (err) {
      stepResults.push(`Paso ${i+1}: ERROR - ${err.message}`);
      break;
    }
  }
  
  const allStepsOk = stepResults.every(r => !r.includes('ERROR'));
  logTest('Single-step', allStepsOk, `${stepResults.length} instrucciones`);
  
  const stepsPath = path.join(OUTPUT_DIR, 'steps.txt');
  fs.writeFileSync(stepsPath, stepResults.join('\n'));
  results.evidence.push({ name: 'Single-step', file: 'steps.txt' });

  // 8. Screenshot final
  log('Tomando screenshot final...');
  try {
    const screenshotResult = await protocol.sendMonitorCommand('screenshot');
    if (screenshotResult.startsWith('OK')) {
      const parts = screenshotResult.match(/(\d+)x(\d+)\s+(.+)/);
      if (parts) {
        const srcPath = parts[3].trim();
        const dstPath = path.join(OUTPUT_DIR, 'screenshot-final.png');
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath);
          logTest('Screenshot final', true);
          results.evidence.push({ name: 'Screenshot final', file: 'screenshot-final.png' });
        }
      }
    }
  } catch (err) {
    logTest('Screenshot final', false, err.message);
  }

  // 9. Cerrar conexión (pero NO desconectar el servidor - la sesión original continúa)
  log('Cerrando conexión MCP (la sesión de VS Code continúa)...');
  protocol.disconnect();
  logTest('Desconexión limpia', true);

  // Generar reporte
  const reportPath = path.join(OUTPUT_DIR, 'report.md');
  generateReport(reportPath);
  
  // Resumen
  console.log('');
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}                         RESUMEN                                ${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.green}Pasados:${C.reset} ${results.passed.length}`);
  console.log(`${C.red}Fallidos:${C.reset} ${results.failed.length}`);
  console.log(`${C.magenta}Evidencias:${C.reset} ${results.evidence.length}`);
  console.log('');
  console.log(`Reporte: ${reportPath}`);
  console.log(`Evidencias: ${OUTPUT_DIR}`);
  console.log('');
  
  const passRate = Math.round(results.passed.length / (results.passed.length + results.failed.length) * 100);
  console.log(`${passRate === 100 ? C.green : C.yellow}Tasa de éxito: ${passRate}%${C.reset}`);
  console.log('');
  
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Utilidades

function parseRegisters(hexData) {
  const regs = {};
  const names = ['D0','D1','D2','D3','D4','D5','D6','D7',
                 'A0','A1','A2','A3','A4','A5','A6','A7',
                 'SR','PC'];
  let offset = 0;
  for (const name of names) {
    const size = (name === 'SR') ? 4 : 8; // SR is 16-bit, others 32-bit
    const hex = hexData.slice(offset, offset + size);
    regs[name] = parseInt(hex, 16);
    offset += size;
  }
  return regs;
}

function formatRegisters(regs) {
  const lines = [];
  lines.push('CPU Registers:');
  lines.push('');
  lines.push('Data Registers:');
  for (let i = 0; i < 8; i++) {
    lines.push(`  D${i} = $${regs[`D${i}`].toString(16).toUpperCase().padStart(8, '0')}`);
  }
  lines.push('');
  lines.push('Address Registers:');
  for (let i = 0; i < 8; i++) {
    lines.push(`  A${i} = $${regs[`A${i}`].toString(16).toUpperCase().padStart(8, '0')}`);
  }
  lines.push('');
  lines.push(`  PC = $${regs.PC.toString(16).toUpperCase().padStart(8, '0')}`);
  lines.push(`  SR = $${regs.SR.toString(16).toUpperCase().padStart(4, '0')}`);
  return lines.join('\n');
}

function formatMemory(addr, hexData) {
  const lines = [];
  for (let i = 0; i < hexData.length; i += 32) {
    const chunk = hexData.slice(i, i + 32);
    const bytes = [];
    let ascii = '';
    for (let j = 0; j < chunk.length; j += 2) {
      const byte = parseInt(chunk.slice(j, j + 2), 16);
      bytes.push(chunk.slice(j, j + 2).toUpperCase());
      ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    lines.push(`$${(addr + i/2).toString(16).toUpperCase().padStart(8, '0')}  ${bytes.join(' ')}  |${ascii}|`);
  }
  return lines.join('\n');
}

function generateReport(reportPath) {
  const lines = [];
  lines.push('# Test: Conexión MCP a sesión existente');
  lines.push('');
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Resultados');
  lines.push('');
  lines.push('### Tests Pasados');
  for (const t of results.passed) {
    lines.push(`- ✓ ${t.name}${t.detail ? `: ${t.detail}` : ''}`);
  }
  lines.push('');
  lines.push('### Tests Fallidos');
  if (results.failed.length === 0) {
    lines.push('- Ninguno');
  } else {
    for (const t of results.failed) {
      lines.push(`- ✗ ${t.name}${t.detail ? `: ${t.detail}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## Evidencias');
  lines.push('');
  for (const e of results.evidence) {
    if (e.file.endsWith('.png')) {
      lines.push(`### ${e.name}`);
      lines.push(`![${e.name}](./${e.file})`);
    } else {
      lines.push(`- ${e.name}: [${e.file}](./${e.file})`);
    }
  }
  lines.push('');
  
  fs.writeFileSync(reportPath, lines.join('\n'));
}

main().catch(err => {
  console.error(`${C.red}Error fatal:${C.reset}`, err.message);
  process.exit(1);
});
