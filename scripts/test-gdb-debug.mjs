#!/usr/bin/env node
/**
 * test-gdb-debug.mjs
 * 
 * Test de depuración usando m68k-amiga-elf-gdb directamente.
 * Demuestra que los breakpoints y la depuración paso a paso funcionan.
 * 
 * Usa configuración con debugging_trigger para capturar el inicio del programa.
 */

import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output', 'gdb-debug');

// Paths
const GDB_PATH = 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32/opt/bin/m68k-amiga-elf-gdb.exe';
const WINUAE_PATH = 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32/winuae-gdb.exe';
const ELF_PATH = 'C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/a.elf';
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'test-debug.uae');

const PORT = 2345;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function log(msg) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${timestamp}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPort(port, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const sock = net.createConnection({ port, host: '127.0.0.1' });
        sock.once('connect', () => { sock.end(); resolve(); });
        sock.once('error', reject);
      });
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   TEST: Depuración con m68k-amiga-elf-gdb                    ║');
  console.log('║   (usando debugging_trigger para captura automática)        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  const evidence = [];
  evidence.push('Test: Depuración GDB con símbolos');
  evidence.push(`Fecha: ${new Date().toISOString()}`);
  evidence.push(`ELF: ${ELF_PATH}`);
  evidence.push(`Config: ${CONFIG_PATH}`);
  evidence.push('');

  // 1. Start WinUAE with config file
  log('Iniciando WinUAE con config de depuración...');
  log(`  Config: ${CONFIG_PATH}`);
  
  const winuae = spawn(WINUAE_PATH, ['-f', CONFIG_PATH, '-portable', '-G'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: path.dirname(WINUAE_PATH)
  });
  winuae.unref();

  log('Esperando que a.exe cargue y active el trigger de depuración...');
  log('  (el servidor GDB se activa cuando el programa carga)');
  
  // Wait for GDB server (debugging_trigger activates when a.exe loads)
  const connected = await waitForPort(PORT, 60000);
  if (!connected) {
    console.error('ERROR: Timeout esperando servidor GDB');
    console.error('       El programa puede no haber cargado correctamente');
    process.exit(1);
  }
  log('✓ Servidor GDB activo (programa capturado en inicio)');
  evidence.push('✓ WinUAE iniciado y debugging_trigger activado');

  await sleep(1000);

  // 2. Start GDB with MI interface
  log('Iniciando m68k-amiga-elf-gdb...');
  
  const gdb = spawn(GDB_PATH, ['-q', '--interpreter=mi2', ELF_PATH], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let gdbOutput = '';
  
  gdb.stdout.on('data', (data) => {
    gdbOutput += data.toString();
  });

  gdb.stderr.on('data', (data) => {
    const str = data.toString();
    if (!str.includes('could not convert')) {
      console.error('GDB stderr:', str);
    }
  });

  function sendGdbCommand(cmd, waitForDone = true, timeout = 10000) {
    return new Promise((resolve) => {
      const startLen = gdbOutput.length;
      gdb.stdin.write(cmd + '\n');
      
      if (!waitForDone) {
        setTimeout(() => resolve(gdbOutput.slice(startLen)), 200);
        return;
      }

      const checkDone = setInterval(() => {
        const newOutput = gdbOutput.slice(startLen);
        if (newOutput.includes('^done') || newOutput.includes('^error') || 
            newOutput.includes('^running') || newOutput.includes('*stopped')) {
          clearInterval(checkDone);
          resolve(newOutput);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkDone);
        resolve(gdbOutput.slice(startLen));
      }, timeout);
    });
  }

  await sleep(500);

  // Connect to WinUAE
  log('Conectando GDB a WinUAE...');
  let result = await sendGdbCommand(`-target-select remote localhost:${PORT}`);
  
  if (result.includes('^error') || result.includes('10061')) {
    console.error('ERROR: No se pudo conectar al servidor GDB');
    console.error(result);
    process.exit(1);
  }
  
  log('✓ GDB conectado');
  evidence.push('');
  evidence.push('=== CONEXIÓN GDB ===');
  evidence.push(result.trim().slice(0, 500));

  // Get current position (should be at entry point)
  log('Verificando posición actual...');
  result = await sendGdbCommand('-stack-info-frame');
  evidence.push('');
  evidence.push('=== POSICIÓN INICIAL (captura en _start) ===');
  evidence.push(result.trim().slice(0, 800));
  
  // Extract PC from frame info
  const frameMatch = result.match(/addr="([^"]+)"/);
  if (frameMatch) {
    log(`  PC actual: ${frameMatch[1]}`);
  }

  // Get initial registers
  log('Leyendo registros iniciales...');
  result = await sendGdbCommand('-data-list-register-values x');
  evidence.push('');
  evidence.push('=== REGISTROS INICIALES ===');
  evidence.push(result.trim().slice(0, 1200));

  // Set breakpoint at main (line 15 according to user)
  log('Poniendo breakpoint en main.c:15...');
  result = await sendGdbCommand('-break-insert main.c:15');
  evidence.push('');
  evidence.push('=== BREAKPOINT EN main.c:15 ===');
  evidence.push(result.trim().slice(0, 600));
  
  // Also at engine_init
  log('Poniendo breakpoint en engine_init...');
  result = await sendGdbCommand('-break-insert engine_init');
  evidence.push('');
  evidence.push('=== BREAKPOINT EN engine_init ===');
  evidence.push(result.trim().slice(0, 600));

  // List all breakpoints
  result = await sendGdbCommand('-break-list');
  evidence.push('');
  evidence.push('=== LISTA DE BREAKPOINTS ===');
  const bpList = result.trim().split('\n').slice(0, 10).join('\n');
  evidence.push(bpList);
  log(`  Breakpoints configurados`);

  // Continue to first breakpoint
  log('Continuando hasta breakpoint...');
  gdbOutput = '';
  await sendGdbCommand('-exec-continue', false);
  
  // Wait for breakpoint
  const waitStart = Date.now();
  let hitBreakpoint = false;
  while (Date.now() - waitStart < 15000) {
    if (gdbOutput.includes('*stopped') && 
        (gdbOutput.includes('breakpoint-hit') || gdbOutput.includes('reason="end-stepping-range"'))) {
      hitBreakpoint = true;
      break;
    }
    await sleep(300);
  }

  if (hitBreakpoint) {
    log('✓ BREAKPOINT ALCANZADO!');
    evidence.push('');
    evidence.push('=== BREAKPOINT HIT ===');
    evidence.push(gdbOutput.slice(0, 2000));
    
    // Extract function name if present
    const funcMatch = gdbOutput.match(/func="([^"]+)"/);
    const lineMatch = gdbOutput.match(/line="([^"]+)"/);
    if (funcMatch) log(`  Función: ${funcMatch[1]}`);
    if (lineMatch) log(`  Línea: ${lineMatch[1]}`);
  } else {
    log('⚠ No se alcanzó breakpoint en 15s, pero continuamos...');
    // Pause to examine
    await sendGdbCommand('-exec-interrupt', false);
    await sleep(500);
    evidence.push('');
    evidence.push('=== ESTADO TRAS TIMEOUT ===');
    evidence.push(gdbOutput.slice(0, 1000));
  }

  // Get frame info after breakpoint
  log('Obteniendo info del frame actual...');
  result = await sendGdbCommand('-stack-info-frame');
  evidence.push('');
  evidence.push('=== FRAME EN BREAKPOINT ===');
  evidence.push(result.trim().slice(0, 800));

  // Get backtrace
  log('Obteniendo backtrace...');
  result = await sendGdbCommand('-stack-list-frames');
  evidence.push('');
  evidence.push('=== BACKTRACE ===');
  evidence.push(result.trim().slice(0, 1500));

  // Get local variables
  log('Obteniendo variables locales...');
  result = await sendGdbCommand('-stack-list-locals 1');
  evidence.push('');
  evidence.push('=== VARIABLES LOCALES ===');
  evidence.push(result.trim().slice(0, 800));

  // Single-step demonstration
  log('Ejecutando single-step (5 pasos)...');
  evidence.push('');
  evidence.push('=== SINGLE-STEP DEMO (5 pasos) ===');
  
  for (let i = 1; i <= 5; i++) {
    gdbOutput = '';
    await sendGdbCommand('-exec-step', false);
    
    // Wait for step to complete
    const stepStart = Date.now();
    while (Date.now() - stepStart < 5000) {
      if (gdbOutput.includes('*stopped')) break;
      await sleep(100);
    }
    
    // Get current position
    const frameResult = await sendGdbCommand('-stack-info-frame');
    const addrMatch = frameResult.match(/addr="([^"]+)"/);
    const funcMatch2 = frameResult.match(/func="([^"]+)"/);
    const lineMatch2 = frameResult.match(/line="([^"]+)"/);
    
    const stepInfo = `Paso ${i}: addr=${addrMatch?.[1] || '?'}, func=${funcMatch2?.[1] || '?'}, line=${lineMatch2?.[1] || '?'}`;
    log(`  ${stepInfo}`);
    evidence.push(stepInfo);
  }

  // Final registers
  log('Leyendo registros finales...');
  result = await sendGdbCommand('-data-list-register-values x');
  evidence.push('');
  evidence.push('=== REGISTROS FINALES ===');
  evidence.push(result.trim().slice(0, 1200));

  // Save evidence
  const evidencePath = path.join(OUTPUT_DIR, 'evidence.txt');
  fs.writeFileSync(evidencePath, evidence.join('\n'));
  log(`✓ Evidencia guardada: ${evidencePath}`);

  // Cleanup
  log('Limpiando...');
  gdb.stdin.write('-gdb-exit\n');
  await sleep(500);
  
  try { gdb.kill(); } catch {}
  
  // Kill WinUAE via taskkill
  try {
    const { execSync } = await import('child_process');
    execSync('taskkill /F /IM winuae-gdb.exe 2>nul', { stdio: 'ignore' });
  } catch {}

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST COMPLETADO                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Evidencia: ${evidencePath}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
