#!/usr/bin/env node
/**
 * Verificación visual del debug peripheral: configura un cobre con COLOR00=$0F3F
 * (magenta) vía GDB, captura la pantalla y, si hay ollama local con un modelo
 * de visión (qwen3-vl / gemma3), describe la imagen para confirmar que la
 * renderización sigue funcionando tras mapear el periférico en 0xB70000.
 *
 * Uso: node scripts/verify-visual-copper.mjs [--ollama-model MODEL]
 */
import { WinUAEConnection } from '../dist/winuae-connection.js';
import fs from 'fs';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function mon(p, cmd, t = 8000) {
  const r = await p.sendMonitorCommand(cmd, t);
  return Buffer.from(r, 'hex').toString('utf8');
}

const WINUAE_PATH = process.env.WINUAE_PATH || 'C:/Users/dvdjg/Documents/programa/AI/Amiga/WinUAE-DBG/bin';
const WINUAE_CONFIG = process.env.WINUAE_CONFIG || 'C:/Users/dvdjg/AppData/Local/Temp/opencode/a500-headless.uae';
const MODEL = process.argv.includes('--ollama-model') ? process.argv[process.argv.indexOf('--ollama-model') + 1] : 'qwen3-vl:8b-instruct-q8_0';
const shotIdx = process.argv.indexOf('--shot');
const SHOT = shotIdx >= 0 && process.argv[shotIdx + 1] ? process.argv[shotIdx + 1] : path.join(process.env.TEMP, 'copper-test.png');

process.env.WINUAE_EXE = 'winuae-gdb.exe';
process.env.WINUAE_HEADLESS = '1';
process.env.WINUAE_USE_LEGACY_LAUNCH = '1';
process.env.WINUAE_GDB_INITIAL_DELAY_MS = process.env.WINUAE_GDB_INITIAL_DELAY_MS || '7000';

async function ollamaDescribe(imagePath) {
  const body = {
    model: MODEL,
    prompt: 'Describe the dominant color of this screen in one short sentence. If it is a solid color, name the color.',
    images: [fs.readFileSync(imagePath).toString('base64')],
    stream: false,
  };
  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!resp) return null;
  const data = await resp.json();
  return String(data.response || '').trim();
}

const conn = new WinUAEConnection({ winuaePath: WINUAE_PATH, configFile: WINUAE_CONFIG, gdbPort: 2345 });
try {
  await conn.connect();
  await sleep(6000);
  const p = conn.getProtocol();
  await p.continue(); await sleep(400); await p.pause();

  // copper: WAIT vpos=1 ; COLOR00=$0F3F (magenta) ; WAIT forever
  await p.writeMemory(0x20000, Buffer.from('0081fffe01800f3ffffffffe', 'hex'));
  await p.writeMemory(0xDFF080, Buffer.from([0x02]));
  await p.writeMemory(0xDFF082, Buffer.from([0x00]));
  await p.writeMemory(0xDFF088, Buffer.from([0x00])); // COPJMP1
  await p.continue(); await sleep(700); await p.pause();
  await sleep(200);

  await mon(p, `screenshot ${SHOT}`, 15000);
  await sleep(400);
  if (!fs.existsSync(SHOT)) { console.log('Screenshot NO creado'); process.exit(1); }
  console.log(`Screenshot OK: ${SHOT} (${fs.statSync(SHOT).size} bytes)`);

  const desc = await ollamaDescribe(SHOT);
  if (desc) {
    console.log(`OLLAMA (${MODEL}): ${desc}`);
    const magenta = /pink|magenta|ros|purple|fuc|colorido|cool.?toned/i.test(desc);
    console.log(magenta ? '=> PANTALLA MAGENTA CONFIRMADA' : '=> aviso: no se detectó magenta en la descripción');
  } else {
    console.log('OLLAMA no disponible (sin servidor local:11434 o modelo de visión) — omisión de análisis visual');
  }
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e.message.slice(0, 160));
  process.exit(1);
} finally {
  try { await conn.disconnect(true); } catch { /* noop */ }
}
