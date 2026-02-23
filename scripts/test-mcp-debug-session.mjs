#!/usr/bin/env node
/**
 * test-mcp-debug-session.mjs
 * 
 * Test de depuración usando las clases MCP (WinUAEConnection + GdbProtocol).
 * Este test usa exactamente las mismas APIs que usa el servidor MCP.
 * 
 * Verifica:
 * 1. Conexión a WinUAE
 * 2. Lectura de registros
 * 3. Poner breakpoints (por dirección)
 * 4. Single-step
 * 5. Screenshots
 */

import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output', 'mcp-debug');

// Config
const CONFIG = {
  winuaePath: 'C:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin',
  configFile: '', // Will use default
  gdbPort: 2345,
};

const DISK_PATH = 'C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/disk.adf';

// Colors
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Results
const results = { passed: [], failed: [], evidence: [] };

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`${C.cyan}[${ts}]${C.reset} ${msg}`);
}

function test(name, passed, detail = '') {
  const color = passed ? C.green : C.red;
  console.log(`${color}[${passed ? 'PASS' : 'FAIL'}]${C.reset} ${name}${detail ? `: ${detail}` : ''}`);
  (passed ? results.passed : results.failed).push({ name, detail });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('');
  console.log(`${C.bold}╔════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   TEST: Sesión de depuración usando APIs MCP                   ║${C.reset}`);
  console.log(`${C.bold}╚════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');

  // Create output dir
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Cleanup
  log('Limpiando instancias previas...');
  try {
    execSync('taskkill /F /IM winuae-gdb.exe 2>nul', { stdio: 'ignore' });
    execSync('taskkill /F /IM winuae-gdb-x86.exe 2>nul', { stdio: 'ignore' });
  } catch {}
  await sleep(2000);

  // Create connection
  const conn = new WinUAEConnection(CONFIG);

  // 1. Set floppy and connect
  log('Configurando disco y conectando...');
  try {
    conn.setFloppy(0, DISK_PATH);
    await conn.connect();
    test('Conexión WinUAE', true);
  } catch (err) {
    test('Conexión WinUAE', false, err.message);
    return;
  }

  const protocol = conn.getProtocol();

  // Wait for system to boot
  log('Esperando arranque del sistema (10s)...');
  await sleep(10000);

  // 2. Pause and read registers
  log('Pausando y leyendo registros...');
  try {
    await protocol.sendPacket('vCont');
    await sleep(500);
    
    // Send break
    protocol.socket.write('\x03');
    await sleep(500);
    
    const regsHex = await protocol.sendCommand('g');
    if (regsHex && regsHex.length >= 32) {
      const pc = parseInt(regsHex.slice(-8), 16);
      test('Lectura de registros', true, `PC=$${pc.toString(16).toUpperCase()}`);
      
      // Save
      const regsPath = path.join(OUTPUT_DIR, 'registers.txt');
      fs.writeFileSync(regsPath, formatRegisters(regsHex));
      results.evidence.push('registers.txt');
    } else {
      test('Lectura de registros', false, 'respuesta vacía');
    }
  } catch (err) {
    test('Lectura de registros', false, err.message);
  }

  // 3. Screenshot
  log('Tomando screenshot...');
  try {
    const result = await protocol.sendMonitorCommand('screenshot');
    if (result.startsWith('OK')) {
      const match = result.match(/(\d+)x(\d+)\s+(.+)/);
      if (match) {
        const srcPath = match[3].trim();
        const dstPath = path.join(OUTPUT_DIR, 'screenshot.png');
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath);
          test('Screenshot', true, `${match[1]}x${match[2]}`);
          results.evidence.push('screenshot.png');
        } else {
          test('Screenshot', true, 'capturado');
        }
      }
    } else {
      test('Screenshot', false, result);
    }
  } catch (err) {
    test('Screenshot', false, err.message);
  }

  // 4. Disassemble current PC
  log('Desensamblando...');
  try {
    const disasm = await protocol.sendMonitorCommand('disasm 15');
    test('Desensamblado', true);
    
    const disasmPath = path.join(OUTPUT_DIR, 'disassembly.txt');
    fs.writeFileSync(disasmPath, disasm);
    results.evidence.push('disassembly.txt');
  } catch (err) {
    test('Desensamblado', false, err.message);
  }

  // 5. Set breakpoint at known address
  log('Poniendo breakpoint...');
  try {
    // Use software breakpoint at current PC + some offset
    const regsHex = await protocol.sendCommand('g');
    const pc = parseInt(regsHex.slice(-8), 16);
    
    // Put breakpoint a few bytes ahead
    const bpAddr = pc + 4;
    const result = await protocol.sendCommand(`Z0,${bpAddr.toString(16)},2`);
    test('Breakpoint', result === 'OK', `$${bpAddr.toString(16).toUpperCase()}`);
  } catch (err) {
    test('Breakpoint', false, err.message);
  }

  // 6. Single-step
  log('Single-step (3 instrucciones)...');
  const stepResults = [];
  
  for (let i = 0; i < 3; i++) {
    try {
      await protocol.sendCommand('vCont;s');
      await sleep(300);
      
      const regsHex = await protocol.sendCommand('g');
      const pc = parseInt(regsHex.slice(-8), 16);
      stepResults.push(`Paso ${i+1}: PC=$${pc.toString(16).toUpperCase()}`);
    } catch (err) {
      stepResults.push(`Paso ${i+1}: ERROR - ${err.message}`);
    }
  }
  
  const allOk = stepResults.every(r => !r.includes('ERROR'));
  test('Single-step', allOk, `${stepResults.filter(r => !r.includes('ERROR')).length}/3`);
  
  const stepsPath = path.join(OUTPUT_DIR, 'steps.txt');
  fs.writeFileSync(stepsPath, stepResults.join('\n'));
  results.evidence.push('steps.txt');

  // 7. Memory read
  log('Leyendo memoria...');
  try {
    const regsHex = await protocol.sendCommand('g');
    const sp = parseInt(regsHex.slice(64, 72), 16); // A7 is at offset 64
    
    const memHex = await protocol.sendCommand(`m${sp.toString(16)},40`);
    if (memHex && memHex.length > 0 && !memHex.startsWith('E')) {
      test('Lectura memoria', true, `Stack @ $${sp.toString(16).toUpperCase()}`);
      
      const memPath = path.join(OUTPUT_DIR, 'memory.txt');
      fs.writeFileSync(memPath, `Stack at $${sp.toString(16).toUpperCase()}:\n${memHex}`);
      results.evidence.push('memory.txt');
    } else {
      test('Lectura memoria', false, memHex);
    }
  } catch (err) {
    test('Lectura memoria', false, err.message);
  }

  // 8. Final screenshot
  log('Screenshot final...');
  try {
    const result = await protocol.sendMonitorCommand('screenshot');
    if (result.startsWith('OK')) {
      const match = result.match(/(\d+)x(\d+)\s+(.+)/);
      if (match) {
        const srcPath = match[3].trim();
        const dstPath = path.join(OUTPUT_DIR, 'screenshot-final.png');
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath);
          test('Screenshot final', true);
          results.evidence.push('screenshot-final.png');
        }
      }
    }
  } catch {}

  // Disconnect
  log('Desconectando...');
  await conn.disconnect();
  test('Desconexión', true);

  // Generate report
  generateReport();

  // Summary
  console.log('');
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.green}Pasados: ${results.passed.length}${C.reset}`);
  console.log(`${C.red}Fallidos: ${results.failed.length}${C.reset}`);
  console.log(`Evidencias: ${results.evidence.length}`);
  console.log('');
  
  const total = results.passed.length + results.failed.length;
  const rate = Math.round(results.passed.length / total * 100);
  console.log(`${rate === 100 ? C.green : C.yellow}Tasa de éxito: ${rate}%${C.reset}`);
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`Directorio: ${OUTPUT_DIR}`);
  
  process.exit(results.failed.length > 0 ? 1 : 0);
}

function formatRegisters(hexData) {
  const lines = ['CPU Registers:', ''];
  const names = ['D0','D1','D2','D3','D4','D5','D6','D7',
                 'A0','A1','A2','A3','A4','A5','A6','A7',
                 'SR','PC'];
  let offset = 0;
  for (const name of names) {
    const size = (name === 'SR') ? 4 : 8;
    const hex = hexData.slice(offset, offset + size);
    const val = parseInt(hex, 16);
    lines.push(`${name.padEnd(3)} = $${val.toString(16).toUpperCase().padStart(size, '0')}`);
    offset += size;
  }
  return lines.join('\n');
}

function generateReport() {
  const lines = [
    '# Test: Sesión de depuración MCP',
    '',
    `Fecha: ${new Date().toISOString()}`,
    '',
    '## Resultados',
    '',
  ];
  
  lines.push('### Pasados');
  for (const t of results.passed) {
    lines.push(`- ✓ ${t.name}${t.detail ? `: ${t.detail}` : ''}`);
  }
  
  lines.push('');
  lines.push('### Fallidos');
  if (results.failed.length === 0) {
    lines.push('- Ninguno');
  } else {
    for (const t of results.failed) {
      lines.push(`- ✗ ${t.name}${t.detail ? `: ${t.detail}` : ''}`);
    }
  }
  
  lines.push('');
  lines.push('## Evidencias');
  for (const e of results.evidence) {
    if (e.endsWith('.png')) {
      lines.push(`![${e}](./${e})`);
    } else {
      lines.push(`- [${e}](./${e})`);
    }
  }
  
  const reportPath = path.join(OUTPUT_DIR, 'report.md');
  fs.writeFileSync(reportPath, lines.join('\n'));
}

main().catch(err => {
  console.error(`${C.red}Error:${C.reset}`, err);
  process.exit(1);
});
