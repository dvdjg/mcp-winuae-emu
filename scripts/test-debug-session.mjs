#!/usr/bin/env node
/**
 * test-debug-session.mjs
 * 
 * Test completo de una sesión de depuración:
 * 1. Inicia WinUAE con debugging_trigger (captura automática del programa)
 * 2. Conecta m68k-amiga-elf-gdb con símbolos
 * 3. Pone breakpoint en main.c:15
 * 4. Continúa hasta el breakpoint
 * 5. Ejecuta single-step
 * 6. Lee variables y registros
 * 7. Toma evidencias
 * 
 * Esto simula exactamente lo que hace la extensión amiga-debug de VS Code.
 */

import { spawn, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output', 'debug-session');

// Paths
const GDB_PATH = 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32/opt/bin/m68k-amiga-elf-gdb.exe';
const WINUAE_PATH = 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32/winuae-gdb.exe';
const WINUAE_DIR = 'C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/win32';
const ELF_PATH = 'C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out/a.elf';
const EXE_DIR = 'C:/Users/dvdjg/Documents/programa/AI/Cursor-Amiga-C/out';
const KICKSTART = 'C:/Amiga/KICK13.rom';

const PORT = 2345;

// Colores
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Ensure output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const evidence = [];

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`${C.cyan}[${ts}]${C.reset} ${msg}`);
  evidence.push(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function killWinuae() {
  try {
    execSync('taskkill /F /IM winuae-gdb.exe 2>nul', { stdio: 'ignore' });
  } catch {}
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
      await sleep(500);
    }
  }
  return false;
}

class GdbMI {
  constructor(gdbPath, elfPath) {
    this.gdbPath = gdbPath;
    this.elfPath = elfPath;
    this.proc = null;
    this.output = '';
    this.tokenCounter = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.gdbPath, ['-q', '--interpreter=mi2', this.elfPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.proc.stdout.on('data', (data) => {
        this.output += data.toString();
      });

      this.proc.stderr.on('data', (data) => {
        const str = data.toString();
        if (!str.includes('could not convert')) {
          log(`GDB stderr: ${str.trim()}`);
        }
      });

      this.proc.on('error', reject);

      // Wait for initial prompt
      setTimeout(resolve, 500);
    });
  }

  async command(cmd, timeout = 15000) {
    const token = this.tokenCounter++;
    const fullCmd = `${token}${cmd}`;
    const startLen = this.output.length;
    
    this.proc.stdin.write(fullCmd + '\n');
    
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const newOutput = this.output.slice(startLen);
      // Look for our token's result
      if (newOutput.includes(`${token}^`) || 
          newOutput.includes('*stopped') ||
          newOutput.includes('^error')) {
        return newOutput;
      }
      await sleep(100);
    }
    return this.output.slice(startLen);
  }

  async commandAsync(cmd) {
    // For async commands, just send and return immediately
    this.proc.stdin.write(cmd + '\n');
    await sleep(100);
  }

  async waitForStop(timeout = 30000) {
    const startLen = this.output.length;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const newOutput = this.output.slice(startLen);
      if (newOutput.includes('*stopped')) {
        return newOutput;
      }
      await sleep(200);
    }
    return null;
  }

  kill() {
    if (this.proc) {
      this.proc.stdin.write('-gdb-exit\n');
      setTimeout(() => this.proc.kill(), 500);
    }
  }
}

async function main() {
  console.log('');
  console.log(`${C.bold}╔════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   TEST: Sesión de depuración completa con breakpoints          ║${C.reset}`);
  console.log(`${C.bold}╚════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');

  // Cleanup any previous instances
  log('Limpiando instancias previas...');
  killWinuae();
  await sleep(2000);

  // Create config file for WinUAE
  const configPath = path.join(OUTPUT_DIR, 'debug.uae');
  const configContent = [
    'use_gui=no',
    'win32.start_not_captured=yes',
    'win32.nonotificationicon=yes',
    'boot_rom_uae=min',
    'quickstart=a500,1',
    'cpu_cycle_exact=true',
    'cpu_memory_cycle_exact=true',
    'blitter_cycle_exact=true',
    'cycle_exact=true',
    'debugging_features=gdbserver',
    'debugging_trigger=:a.exe',  // KEY: This pauses when a.exe loads
    'ntsc=false',
    `kickstart_rom_file=${KICKSTART}`,
    `filesystem=rw,dh0:C:/Users/dvdjg/.cursor/extensions/bartmanabyss.amiga-debug-1.7.9/bin/dh0`,
    `filesystem2=rw,dh1:dh1:${EXE_DIR},-128`,
  ].join('\n');
  fs.writeFileSync(configPath, configContent);
  log(`Config escrito: ${configPath}`);

  // Start WinUAE
  log('Iniciando WinUAE...');
  const winuae = spawn(WINUAE_PATH, ['-f', configPath, '-portable', '-G'], {
    detached: true,
    stdio: 'ignore',
    cwd: WINUAE_DIR,
    windowsHide: false
  });
  winuae.unref();

  // Wait for GDB server (activates when a.exe loads due to debugging_trigger)
  log('Esperando que a.exe cargue (debugging_trigger)...');
  log('  (Esto puede tomar 10-30 segundos mientras el sistema arranca)');
  
  const gdbAvailable = await waitForPort(PORT, 60000);
  if (!gdbAvailable) {
    log(`${C.red}ERROR: Timeout esperando servidor GDB${C.reset}`);
    killWinuae();
    process.exit(1);
  }
  log(`${C.green}✓ Servidor GDB activo - programa capturado${C.reset}`);

  // Start GDB
  log('Iniciando m68k-amiga-elf-gdb...');
  const gdb = new GdbMI(GDB_PATH, ELF_PATH);
  await gdb.start();

  // Connect to WinUAE
  log('Conectando GDB a WinUAE...');
  let result = await gdb.command(`-target-select remote localhost:${PORT}`);
  
  if (result.includes('^error') || result.includes('Connection refused')) {
    log(`${C.red}ERROR: No se pudo conectar${C.reset}`);
    log(result);
    gdb.kill();
    killWinuae();
    process.exit(1);
  }
  log(`${C.green}✓ GDB conectado${C.reset}`);

  // Get initial position
  log('Posición inicial (captura en _start)...');
  result = await gdb.command('-stack-info-frame');
  evidence.push('--- FRAME INICIAL ---');
  evidence.push(result.slice(0, 500));
  
  const addrMatch = result.match(/addr="([^"]+)"/);
  const funcMatch = result.match(/func="([^"]+)"/);
  if (addrMatch) log(`  PC: ${addrMatch[1]}`);
  if (funcMatch) log(`  Función: ${funcMatch[1]}`);

  // Set breakpoint at main.c:15
  log('Poniendo breakpoint en main.c:15 (engine_init)...');
  result = await gdb.command('-break-insert main.c:15');
  evidence.push('--- BREAKPOINT main.c:15 ---');
  evidence.push(result.slice(0, 500));
  
  if (result.includes('^done')) {
    const bpAddr = result.match(/addr="([^"]+)"/);
    log(`${C.green}✓ Breakpoint configurado${C.reset}${bpAddr ? ` en ${bpAddr[1]}` : ''}`);
  } else {
    log(`${C.yellow}⚠ Breakpoint puede no estar configurado${C.reset}`);
  }

  // Also at engine_init function
  log('Poniendo breakpoint en engine_init()...');
  result = await gdb.command('-break-insert engine_init');
  evidence.push('--- BREAKPOINT engine_init ---');
  evidence.push(result.slice(0, 500));

  // Continue to breakpoint
  log('Continuando ejecución...');
  await gdb.commandAsync('-exec-continue');

  // Wait for breakpoint
  log('Esperando breakpoint (hasta 30s)...');
  const stopResult = await gdb.waitForStop(30000);
  
  if (stopResult && stopResult.includes('breakpoint-hit')) {
    log(`${C.green}✓ BREAKPOINT ALCANZADO!${C.reset}`);
    evidence.push('--- BREAKPOINT HIT ---');
    evidence.push(stopResult.slice(0, 1000));
    
    const bpFunc = stopResult.match(/func="([^"]+)"/);
    const bpLine = stopResult.match(/line="([^"]+)"/);
    const bpFile = stopResult.match(/file="([^"]+)"/);
    if (bpFunc) log(`  Función: ${bpFunc[1]}`);
    if (bpLine) log(`  Línea: ${bpLine[1]}`);
    if (bpFile) log(`  Archivo: ${path.basename(bpFile[1])}`);
  } else {
    log(`${C.yellow}⚠ No se alcanzó breakpoint en 30s${C.reset}`);
    // Try to interrupt
    await gdb.commandAsync('-exec-interrupt');
    await sleep(1000);
  }

  // Get current frame
  log('Frame actual...');
  result = await gdb.command('-stack-info-frame');
  evidence.push('--- FRAME EN BREAKPOINT ---');
  evidence.push(result.slice(0, 500));

  // Get backtrace
  log('Backtrace...');
  result = await gdb.command('-stack-list-frames');
  evidence.push('--- BACKTRACE ---');
  evidence.push(result.slice(0, 1000));

  // Single-step demo
  log('Single-step (3 pasos)...');
  evidence.push('--- SINGLE-STEP ---');
  
  for (let i = 1; i <= 3; i++) {
    await gdb.commandAsync('-exec-step');
    const stepStop = await gdb.waitForStop(5000);
    
    result = await gdb.command('-stack-info-frame');
    const stepAddr = result.match(/addr="([^"]+)"/);
    const stepFunc = result.match(/func="([^"]+)"/);
    const stepLine = result.match(/line="([^"]+)"/);
    
    const info = `Paso ${i}: ${stepFunc?.[1] || '?'}:${stepLine?.[1] || '?'} @ ${stepAddr?.[1] || '?'}`;
    log(`  ${info}`);
    evidence.push(info);
  }

  // Get registers
  log('Registros finales...');
  result = await gdb.command('-data-list-register-values x');
  evidence.push('--- REGISTROS ---');
  evidence.push(result.slice(0, 1500));

  // Save evidence
  const evidencePath = path.join(OUTPUT_DIR, 'evidence.txt');
  fs.writeFileSync(evidencePath, evidence.join('\n'));
  log(`Evidencia guardada: ${evidencePath}`);

  // Cleanup
  log('Limpiando...');
  gdb.kill();
  await sleep(500);
  killWinuae();

  console.log('');
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.green}TEST COMPLETADO${C.reset}`);
  console.log(`Evidencia: ${OUTPUT_DIR}`);
  console.log(`${C.bold}════════════════════════════════════════════════════════════════${C.reset}`);
}

main().catch(err => {
  console.error(`${C.red}Error:${C.reset}`, err);
  killWinuae();
  process.exit(1);
});
