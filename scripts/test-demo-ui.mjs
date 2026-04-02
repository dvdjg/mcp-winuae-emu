#!/usr/bin/env node
/**
 * Integration test: calculadora + demo + salir con ambos botones.
 * Lanza WinUAE con el ADF de la demo, envía entradas de ratón, captura pantallas.
 *
 * Uso: node scripts/test-demo-ui.mjs [ruta-adf]
 *   ruta-adf: default ../Cursor-Amiga-C/out/disk.adf
 *
 * Requiere: WinUAE-DBG compilado, mcp-winuae-emu built (npm run build).
 * Variables: WINUAE_PATH, WINUAE_CONFIG, WINUAE_GDB_PORT, WINUAE_CONNECT_EXISTING=1
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import * as path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultAdf = path.join(projectRoot, '..', 'Cursor-Amiga-C', 'out', 'disk.adf');
const adfPath = path.resolve(process.argv[2] || defaultAdf);

if (!existsSync(adfPath)) {
  console.error('ADF no encontrado:', adfPath);
  console.error('Primero: cd Cursor-Amiga-C && make LTO=0 && make adf');
  process.exit(1);
}

const config = {
  winuaePath: process.env.WINUAE_PATH || path.join(projectRoot, '..', 'WinUAE-DBG', 'bin'),
  configFile: process.env.WINUAE_CONFIG || path.join(projectRoot, '..', 'Cursor-Amiga-C', '.vscode', 'mcp-amiga-debug.uae'),
  gdbPort: parseInt(process.env.WINUAE_GDB_PORT || '2345', 10),
};

const outDir = process.env.WINUAE_SCREENSHOT_DIR || path.join(projectRoot, '..', 'Cursor-Amiga-C', 'out');
const screenshot = (name) => path.join(outDir, `${name}.png`).replace(/\//g, '\\');

async function main() {
  const conn = new WinUAEConnection(config);
  const connectExisting = process.env.WINUAE_CONNECT_EXISTING === '1';

  conn.setFloppy(0, adfPath);
  if (!connectExisting) {
    process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '6000';
    console.log('Iniciando WinUAE con', path.basename(adfPath), '...');
    await conn.connect();
    console.log('Conectado. Esperando 25s para que arranque la demo...');
    await new Promise((r) => setTimeout(r, 25000));
  } else {
    console.log('Conectando a WinUAE existente...');
    await conn.connectExisting();
    console.log('Conectado. Esperando 10s...');
    await new Promise((r) => setTimeout(r, 10000));
  }

  const protocol = conn.getProtocol();
  const send = (cmd) => protocol.sendMonitorCommand(cmd, 30000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const click = async (x, y) => {
    await send(`input mouse abs ${x} ${y}`);
    await sleep(100);
    await send('input mouse button 0 1');
    await sleep(150);
    await send('input mouse button 0 0');
    await sleep(150);
  };

  const bothButtons = async (down) => {
    const st = down ? 1 : 0;
    await send(`input mouse button 0 ${st}`);
    await send(`input mouse button 1 ${st}`);
  };

  let passed = 0;
  let failed = 0;

  /* --- Test 1: Calculadora 2+2=4 --- */
  console.log('\n[Test 1] Calculadora: 2 + 2 = 4');
  try {
    await send(`screenshot ${screenshot('calc-before')}`);
    // Coords desde intuition_calc.c (centros aproximados)
    await click(75, 88);   // 2
    await click(165, 48);  // +
    await click(75, 88);   // 2
    await click(120, 108); // =
    await sleep(300);
    await send(`screenshot ${screenshot('calc-after-2plus2')}`);
    console.log('  Captura en out/calc-after-2plus2.png (verificar manualmente que muestre 4)');
    passed++;
  } catch (e) {
    console.error('  FALLO:', e.message);
    failed++;
  }

  /* --- Test 2: Entrar en demo y salir con ambos botones --- */
  console.log('\n[Test 2] Demo: entrar y salir con ambos botones');
  try {
    // Intentar clic en Demo: Intuition (240,50) o menú fallback (200,110)
    await click(240, 50);
    await sleep(500);
    await click(200, 110);
    await sleep(2000);
    await send(`screenshot ${screenshot('demo-running')}`);
    await sleep(500);
    await bothButtons(1);
    await sleep(800);
    await send(`screenshot ${screenshot('demo-after-both-btns')}`);
    await bothButtons(0);
    await sleep(300);
    console.log('  Capturas: demo-running.png, demo-after-both-btns.png');
    console.log('  Verificar: demo-after-both-btns debe mostrar menú/calculadora (salimos de demo)');
    passed++;
  } catch (e) {
    console.error('  FALLO:', e.message);
    failed++;
  }

  console.log('\n--- Resumen ---');
  console.log('Pasados:', passed, '| Fallidos:', failed);
  console.log('Capturas en:', outDir);
  if (process.env.LM_STUDIO_BASE_URL || existsSync(path.join(projectRoot, '..', 'Cursor-Amiga-C', '.cursor', 'lmstudio.json'))) {
    console.log('Para verificación automática: node ../Cursor-Amiga-C/scripts/verify-display-with-lmstudio.mjs out/calc-after-2plus2.png');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
