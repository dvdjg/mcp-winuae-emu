#!/usr/bin/env node
/**
 * Script de verificación de WinUAE-DBG
 * Verifica que todas las extensiones de depuración del servidor GDB funcionan correctamente.
 * 
 * Uso: node scripts/verify-winuae-dbg.mjs
 * 
 * Variables de entorno:
 *   WINUAE_PATH - Ruta al directorio de WinUAE-DBG (default: ver abajo)
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

// Resultados de tests
const results = {
  passed: [],
  failed: [],
  skipped: [],
};

// Colores ANSI
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(msg) {
  console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
}

function logPass(test, detail = '') {
  results.passed.push({ test, detail });
  console.log(`${colors.green}[PASS]${colors.reset} ${test}${detail ? ` - ${detail}` : ''}`);
}

function logFail(test, error) {
  results.failed.push({ test, error: error.message || String(error) });
  console.log(`${colors.red}[FAIL]${colors.reset} ${test} - ${error.message || error}`);
}

function logSkip(test, reason) {
  results.skipped.push({ test, reason });
  console.log(`${colors.yellow}[SKIP]${colors.reset} ${test} - ${reason}`);
}

// Utilidades
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

// Tests
async function testConnection(conn) {
  log('Test 1: Conexión al servidor GDB');
  try {
    const protocol = conn.getProtocol();
    if (!protocol.connected) throw new Error('Protocol not connected');
    logPass('Conexión GDB', `Puerto ${CONFIG.gdbPort}`);
    return true;
  } catch (err) {
    logFail('Conexión GDB', err);
    return false;
  }
}

async function testReadRegisters(protocol) {
  log('Test 2: Lectura de registros CPU (D0-D7, A0-A7, SR, PC)');
  try {
    const regs = await protocol.readRegisters();
    const regNames = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
                      'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'SR', 'PC'];
    const missing = regNames.filter(r => regs[r] === undefined);
    if (missing.length > 0) throw new Error(`Missing registers: ${missing.join(', ')}`);
    logPass('Lectura de registros', `PC=$${regs.PC.toString(16).toUpperCase()}, SP(A7)=$${regs.A7.toString(16).toUpperCase()}`);
    return regs;
  } catch (err) {
    logFail('Lectura de registros', err);
    return null;
  }
}

async function testReadMemory(protocol) {
  log('Test 3: Lectura de memoria (Chip RAM $0-$FF)');
  try {
    const mem = await protocol.readMemory(0, 256);
    if (mem.length !== 256) throw new Error(`Expected 256 bytes, got ${mem.length}`);
    const sample = mem.slice(0, 8).toString('hex').toUpperCase();
    logPass('Lectura de memoria', `$0000: ${sample}...`);
    return true;
  } catch (err) {
    logFail('Lectura de memoria', err);
    return false;
  }
}

async function testReadCustomRegisters(protocol) {
  log('Test 4: Lectura de registros custom chip ($DFF000-$DFF1FE)');
  try {
    const mem = await protocol.readMemory(0xDFF000, 0x200);
    if (mem.length !== 0x200) throw new Error(`Expected 512 bytes, got ${mem.length}`);
    // DMACON está en offset 0x002 (pero solo es escribible, leer DMACONR en 0x002)
    // VPOSR está en offset 0x004
    const vposr = (mem[0x04] << 8) | mem[0x05];
    logPass('Lectura custom registers', `VPOSR=$${vposr.toString(16).toUpperCase()}`);
    return true;
  } catch (err) {
    logFail('Lectura custom registers', err);
    return false;
  }
}

async function testWriteMemory(protocol) {
  log('Test 5: Escritura de memoria');
  try {
    // Escribir en una zona segura de Chip RAM (evitar los primeros bytes del sistema)
    const testAddr = 0x1000;
    const testData = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    
    // Leer valor original
    const original = await protocol.readMemory(testAddr, 4);
    
    // Escribir dato de prueba
    await protocol.writeMemory(testAddr, testData);
    
    // Verificar
    const verify = await protocol.readMemory(testAddr, 4);
    if (!verify.equals(testData)) {
      throw new Error(`Write verification failed: expected ${testData.toString('hex')}, got ${verify.toString('hex')}`);
    }
    
    // Restaurar original
    await protocol.writeMemory(testAddr, original);
    
    logPass('Escritura de memoria', `Escrito $${testAddr.toString(16)}: DEADBEEF`);
    return true;
  } catch (err) {
    logFail('Escritura de memoria', err);
    return false;
  }
}

async function testWriteRegister(protocol, originalRegs) {
  log('Test 6: Escritura de registros');
  try {
    // Leer D0 actual
    const originalD0 = originalRegs.D0;
    
    // Escribir nuevo valor en D0 (registro 0)
    const testValue = 0x12345678;
    await protocol.writeRegister(0, testValue);
    
    // Verificar
    const regs = await protocol.readRegisters();
    if (regs.D0 !== testValue) {
      throw new Error(`D0 write failed: expected $${testValue.toString(16)}, got $${regs.D0.toString(16)}`);
    }
    
    // Restaurar
    await protocol.writeRegister(0, originalD0);
    
    logPass('Escritura de registros', `D0=$${testValue.toString(16).toUpperCase()} (restaurado)`);
    return true;
  } catch (err) {
    logFail('Escritura de registros', err);
    return false;
  }
}

async function testSingleStep(protocol) {
  log('Test 7: Single-step (ejecución paso a paso)');
  try {
    const before = await protocol.readRegisters();
    const stopReply = await protocol.step();
    const after = await protocol.readRegisters();
    
    // El PC debería haber cambiado (avanzado al menos 2 bytes)
    if (after.PC === before.PC) {
      logSkip('Single-step', 'PC no cambió (puede estar en un bucle cerrado)');
      return null;
    }
    
    logPass('Single-step', `PC: $${before.PC.toString(16)} → $${after.PC.toString(16)}, stop=${stopReply}`);
    return true;
  } catch (err) {
    logFail('Single-step', err);
    return false;
  }
}

async function testBreakpoint(protocol) {
  log('Test 8: Breakpoints (set/clear)');
  try {
    const testAddr = 0xFC0000; // Kickstart ROM - una dirección segura
    
    // Establecer breakpoint
    await protocol.setBreakpoint(testAddr);
    logPass('Breakpoint set', `$${testAddr.toString(16).toUpperCase()}`);
    
    // Eliminar breakpoint
    await protocol.clearBreakpoint(testAddr);
    logPass('Breakpoint clear', `$${testAddr.toString(16).toUpperCase()}`);
    
    return true;
  } catch (err) {
    logFail('Breakpoints', err);
    return false;
  }
}

async function testWatchpoint(protocol) {
  log('Test 9: Watchpoints (write/read/access)');
  try {
    const testAddr = 0x1000;
    const testLen = 4;
    
    // Write watchpoint
    await protocol.setWatchpoint(testAddr, testLen, 'write');
    await protocol.clearWatchpoint(testAddr, testLen, 'write');
    logPass('Watchpoint write', `$${testAddr.toString(16)}, len=${testLen}`);
    
    // Read watchpoint
    await protocol.setWatchpoint(testAddr, testLen, 'read');
    await protocol.clearWatchpoint(testAddr, testLen, 'read');
    logPass('Watchpoint read', `$${testAddr.toString(16)}, len=${testLen}`);
    
    // Access watchpoint
    await protocol.setWatchpoint(testAddr, testLen, 'access');
    await protocol.clearWatchpoint(testAddr, testLen, 'access');
    logPass('Watchpoint access', `$${testAddr.toString(16)}, len=${testLen}`);
    
    return true;
  } catch (err) {
    logFail('Watchpoints', err);
    return false;
  }
}

async function testScreenshot(protocol, outputDir) {
  log('Test 10: Screenshot (captura de pantalla)');
  try {
    const filename = path.join(outputDir, 'test-screenshot.png').replace(/\//g, '\\');
    const reply = await protocol.sendMonitorCommand(`screenshot ${filename}`, 15000);
    
    // Verificar que el archivo existe
    await sleep(500);
    if (!fs.existsSync(filename)) {
      throw new Error(`Screenshot file not created: ${filename}`);
    }
    
    const stats = fs.statSync(filename);
    logPass('Screenshot', `${filename} (${stats.size} bytes)`);
    return filename;
  } catch (err) {
    logFail('Screenshot', err);
    return null;
  }
}

async function testDisassemble(protocol) {
  log('Test 11: Desensamblado (disasm)');
  try {
    const regs = await protocol.readRegisters();
    const reply = await protocol.sendMonitorCommand(`disasm ${regs.PC.toString(16)} 5`, 10000);
    
    // La respuesta viene en hex, decodificar
    const decoded = Buffer.from(reply, 'hex').toString('utf8');
    if (!decoded || decoded.length < 10) {
      throw new Error('Disassembly output too short');
    }
    
    const firstLine = decoded.split('\n')[0];
    logPass('Desensamblado', `PC $${regs.PC.toString(16)}: ${firstLine.slice(0, 50)}...`);
    return true;
  } catch (err) {
    logFail('Desensamblado', err);
    return false;
  }
}

async function testInputKey(protocol) {
  log('Test 12: Input - Simulación de teclado');
  try {
    // Presionar y soltar Space (scancode 0x40)
    await protocol.sendMonitorCommand('input key 0x40 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input key 0x40 0', 5000);
    logPass('Input key', 'Space (0x40) press/release');
    return true;
  } catch (err) {
    logFail('Input key', err);
    return false;
  }
}

async function testInputJoystick(protocol) {
  log('Test 13: Input - Simulación de joystick');
  try {
    // Puerto 1 (index 0), mover derecha
    await protocol.sendMonitorCommand('input joy 0 right 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input joy 0 right 0', 5000);
    logPass('Input joystick', 'Port 1 Right press/release');
    
    // Fire
    await protocol.sendMonitorCommand('input joy 0 fire 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input joy 0 fire 0', 5000);
    logPass('Input joystick fire', 'Port 1 Fire press/release');
    
    return true;
  } catch (err) {
    logFail('Input joystick', err);
    return false;
  }
}

async function testInputMouse(protocol) {
  log('Test 14: Input - Simulación de ratón');
  try {
    // Movimiento relativo
    await protocol.sendMonitorCommand('input mouse move 10 5', 5000);
    logPass('Input mouse move', 'dx=10, dy=5');
    
    // Botón izquierdo
    await protocol.sendMonitorCommand('input mouse button 0 1', 5000);
    await sleep(100);
    await protocol.sendMonitorCommand('input mouse button 0 0', 5000);
    logPass('Input mouse button', 'Left click');
    
    return true;
  } catch (err) {
    logFail('Input mouse', err);
    return false;
  }
}

async function testDiskOperations(protocol) {
  log('Test 15: Operaciones de disco (insert/eject en caliente)');
  try {
    // Expulsar DF0
    await protocol.sendMonitorCommand('df0 eject', 10000);
    logPass('Disk eject', 'DF0: ejected');
    
    // Reinsertar disco
    const adfPath = GAME_ADF.replace(/\//g, '\\');
    await protocol.sendMonitorCommand(`df0 insert ${adfPath}`, 10000);
    logPass('Disk insert', `DF0: ${path.basename(GAME_ADF)}`);
    
    return true;
  } catch (err) {
    logFail('Disk operations', err);
    return false;
  }
}

async function testContinueAndPause(protocol) {
  log('Test 16: Continue y Pause');
  try {
    // Continue
    await protocol.continue();
    logPass('Continue', 'Ejecución reanudada');
    
    // Esperar un momento
    await sleep(500);
    
    // Pause
    const stopReply = await protocol.pause();
    logPass('Pause', `Ejecución detenida: ${stopReply}`);
    
    return true;
  } catch (err) {
    logFail('Continue/Pause', err);
    return false;
  }
}

async function testReadKickstartROM(protocol) {
  log('Test 17: Lectura de Kickstart ROM ($FC0000)');
  try {
    const mem = await protocol.readMemory(0xFC0000, 16);
    if (mem.length !== 16) throw new Error(`Expected 16 bytes, got ${mem.length}`);
    
    const sample = mem.toString('hex').toUpperCase();
    logPass('Lectura Kickstart ROM', `$FC0000: ${sample}`);
    return true;
  } catch (err) {
    logFail('Lectura Kickstart ROM', err);
    return false;
  }
}

// Main
async function main() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       VERIFICACIÓN DE WinUAE-DBG - Extensiones GDB');
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
  conn.setFloppy(0, GAME_ADF);
  
  try {
    log('Iniciando WinUAE con ' + path.basename(GAME_ADF) + '...');
    await conn.connect();
    log('Conectado. Esperando 10s para que arranque el juego...');
    await sleep(10000);
    
    const protocol = conn.getProtocol();
    
    // Ejecutar tests
    await testConnection(conn);
    const regs = await testReadRegisters(protocol);
    await testReadMemory(protocol);
    await testReadCustomRegisters(protocol);
    await testWriteMemory(protocol);
    if (regs) await testWriteRegister(protocol, regs);
    await testSingleStep(protocol);
    await testBreakpoint(protocol);
    await testWatchpoint(protocol);
    await testScreenshot(protocol, OUTPUT_DIR);
    await testDisassemble(protocol);
    await testInputKey(protocol);
    await testInputJoystick(protocol);
    await testInputMouse(protocol);
    await testContinueAndPause(protocol);
    await testReadKickstartROM(protocol);
    
    // Test de disco al final (puede afectar al estado)
    await testDiskOperations(protocol);
    
    // Screenshot final
    log('Capturando screenshot final...');
    await sleep(2000);
    const finalScreenshot = path.join(OUTPUT_DIR, 'test-final.png').replace(/\//g, '\\');
    await protocol.sendMonitorCommand(`screenshot ${finalScreenshot}`, 15000);
    
  } catch (err) {
    console.error(`${colors.red}ERROR CRÍTICO: ${err.message}${colors.reset}`);
    results.failed.push({ test: 'Inicialización', error: err.message });
  } finally {
    log('Desconectando...');
    await conn.disconnect();
  }
  
  // Resumen
  console.log('');
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                      RESUMEN DE RESULTADOS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${colors.reset}`);
  
  console.log(`${colors.green}PASADOS: ${results.passed.length}${colors.reset}`);
  for (const r of results.passed) {
    console.log(`  ✓ ${r.test}`);
  }
  
  if (results.failed.length > 0) {
    console.log(`\n${colors.red}FALLIDOS: ${results.failed.length}${colors.reset}`);
    for (const r of results.failed) {
      console.log(`  ✗ ${r.test}: ${r.error}`);
    }
  }
  
  if (results.skipped.length > 0) {
    console.log(`\n${colors.yellow}OMITIDOS: ${results.skipped.length}${colors.reset}`);
    for (const r of results.skipped) {
      console.log(`  ○ ${r.test}: ${r.reason}`);
    }
  }
  
  console.log('');
  const total = results.passed.length + results.failed.length + results.skipped.length;
  const pct = Math.round((results.passed.length / total) * 100);
  console.log(`Total: ${results.passed.length}/${total} tests pasados (${pct}%)`);
  
  if (results.failed.length > 0) {
    console.log(`\n${colors.red}⚠ Hay ${results.failed.length} test(s) fallido(s)${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}✓ Todos los tests pasaron correctamente${colors.reset}`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`${colors.red}Error fatal: ${err.message}${colors.reset}`);
  process.exit(1);
});
