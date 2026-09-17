/**
 * winuae_profile_ollama: captura un perfil por el canal lateral (2346),
 * extrae frames + resumen tecnico y analiza con Ollama LOCAL (sin tokens de
 * la nube). Devuelve un informe markdown con la descripcion fiel de lo que se
 * esta renderizando y el estado tecnico del frame.
 *
 * Flujo:
 *   1. lock acquire <owner> assist
 *   2. profile <frames> "<out.bin>"
 *   3. action status <id> / profile-status hasta "done"
 *   4. lock release <owner>
 *   5. parse binario -> frames + profile-summary.json
 *   6. Ollama: pre-analisis "meta" (texto) + vision (frames/hoja de contacto)
 */
import { sideChannelCommand } from './side-channel.js';
import { parseProfile, Profile } from './profile-parse.js';
import * as path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ProfileOllamaRequest {
  numFrames: number;
  outDir: string;
  sidePort: number;
  lockOwner: string;
  waitCmd?: string;
  waitContains?: string;
  waitTimeoutMs: number;
  prompt?: string;
  promptFile?: string;
  model: string;
  textModel: string;
  base: string;
  mode: 'meta' | 'frames' | 'montage' | 'all';
  selectedFrames?: number[];
  binFile?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sideCommand(port: number, cmd: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
  const r = await sideChannelCommand(cmd, port, timeoutMs);
  if (!r.ok || !r.reply) {
    throw new Error(`canal lateral (${port}): ${cmd} -> ${r.error || r.raw || 'sin respuesta'}`);
  }
  return r.reply;
}

/** Replica capture-profile.mjs: lock assist -> profile -> espera done -> release. */
async function captureProfileSideChannel(
  port: number,
  outFile: string,
  frames: number,
  lockOwner: string,
  waitCmd?: string,
  waitContains?: string,
  waitTimeoutMs = 20000
): Promise<void> {
  // Condicion opcional: espera a que un comando del canal devuelva un texto.
  if (waitCmd && waitContains) {
    const deadline = Date.now() + waitTimeoutMs;
    for (;;) {
      try {
        const r = await sideChannelCommand(waitCmd, port, 3000);
        const text = r.raw ?? JSON.stringify(r.reply ?? '');
        if (text.includes(waitContains)) break;
      } catch {
        // reintenta
      }
      if (Date.now() > deadline) throw new Error(`timeout esperando condicion: ${waitCmd}`);
      await sleep(200);
    }
  }

  await sideCommand(port, `lock acquire ${lockOwner} assist`, 5000);

  const queued = await sideCommand(port, `profile ${frames} "${outFile}"`, 10000);
  const id = queued.id ?? queued.actionId;
  if (!queued.ok && !id) throw new Error(`no se pudo encolar el profile: ${JSON.stringify(queued)}`);
  if (id !== undefined) {
    for (let i = 0; i < 120; i++) {
      const st = await sideCommand(port, `action status ${id}`, 10000);
      if (st.ok === true || st.status === 'done' || st.result !== undefined) break;
      await sleep(250);
    }
  }
  for (let i = 0; i < 120; i++) {
    const st = await sideCommand(port, 'profile-status', 10000);
    if (JSON.stringify(st).includes('done')) break;
    await sleep(250);
  }

  try {
    await sideCommand(port, `lock release ${lockOwner}`, 3000);
  } catch {
    // noop
  }
}

const DMA_TYPE_NAMES: Record<number, string> = {
  1: 'Refresh', 2: 'CPU', 3: 'Copper', 4: 'Audio', 5: 'Blitter',
  6: 'Bitplane', 7: 'Sprite', 8: 'Disk', 9: 'DMA conflict',
};

function frameRegisters(frame: Profile['frames'][number]): Record<string, number> {
  const names: Record<string, number> = {
    BPLCON0: 0x100, BPLCON1: 0x102, BPLCON2: 0x104, BPL1MOD: 0x108, BPL2MOD: 0x10a,
    DIWSTRT: 0x08e, DIWSTOP: 0x090, DDFSTRT: 0x092, DDFSTOP: 0x094,
    BPL0PT: 0x0e0, BPL1PT: 0x0e2, BPL2PT: 0x0e4, BPL3PT: 0x0e6, BPL4PT: 0x0e8, BPL5PT: 0x0ea,
    COLOR00: 0x180, COLOR01: 0x182,
  };
  const regs: Record<string, number> = {};
  for (const [name, idx] of Object.entries(names)) {
    const customIdx = idx / 2;
    if (customIdx >= 0 && customIdx < 256) regs[name] = frame.customRegs[customIdx];
  }
  return regs;
}

function buildSummary(profile: Profile, binName: string): unknown {
  return {
    file: binName,
    sectionBases: profile.sectionBases.map((v) => '0x' + v.toString(16)),
    baseClock: profile.baseClock,
    cpuCycleUnit: profile.cpuCycleUnit,
    numFrames: profile.frames.length,
    cpuSamples: buildSampleSummary(profile),
    frames: profile.frames.map((frame, i) => ({
      frame: i,
      screenshot: `frame_${String(i).padStart(4, '0')}.${frame.screenshotType}`,
      chipsetFlags: frame.chipsetFlags,
      registers: frameRegisters(frame),
      bitplanes: frame.gfxResources.filter((r) => r.type === 0),
      palette: frame.gfxResources.filter((r) => r.type === 1),
      dma: frame.dmaSummary,
      profileCycles: frame.profileCycles,
      idleCycles: frame.idleCycles,
    })),
  };
}

/**
 * Agrega las muestras de CPU (PCs) por rutina. Los PCs son direcciones de RUNTIME; sin
 * simbolos solo se puede decir cuantos PC caen en cada seccion (indice de seccion) y su
 * offset dentro de ella, que es suficiente para localizar el bucle caliente a mano.
 */
function buildSampleSummary(profile: Profile): unknown {
  const total = profile.frames.reduce((n, f) => n + f.profileArray.length, 0);
  if (total === 0) {
    return { totalSamples: 0, note: 'sin muestras: WinUAE necesita la tabla .unwind' };
  }
  const bases = profile.sectionBases;
  const perSection = bases.map(() => 0);
  const hotPc = new Map<number, number>();
  for (const f of profile.frames) {
    for (const pc of f.profileArray) {
      let best = -1;
      for (let i = 0; i < bases.length; i++) {
        if (pc >= bases[i] && (best < 0 || bases[i] > bases[best])) best = i;
      }
      if (best >= 0) perSection[best]++;
      if (best >= 0) hotPc.set(pc, (hotPc.get(pc) || 0) + 1);
    }
  }
  const top = [...hotPc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([pc, n]) => ({ pc: '0x' + pc.toString(16), samples: n, pct: Number((100 * n / total).toFixed(1)) }));
  return {
    totalSamples: total,
    perSection: bases.map((b, i) => ({ section: i, base: '0x' + b.toString(16), samples: perSection[i] })),
    topPc: top,
  };
}

/** Escribe frames y profile-summary.json en outDir. */
async function extractProfile(profile: Profile, outDir: string, binName: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = buildSummary(profile, binName);
  profile.frames.forEach((frame, i) => {
    const ext = frame.screenshotType;
    fs.writeFileSync(path.join(outDir, `frame_${String(i).padStart(4, '0')}.${ext}`), frame.screenshot);
  });
  fs.writeFileSync(path.join(outDir, 'profile-summary.json'), JSON.stringify(summary, null, 2));
}

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
}

async function ollamaChat(base: string, model: string, messages: OllamaMessage[]): Promise<string> {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

const DEFAULT_PROMPT = `Eres un analizador de capturas de pantalla de una demo/programa para Amiga (OCS/ECS/AGA). Describe con PRECISION lo que se ve: colores, formas, elementos (bandas, blobs, tiles, sprites, texto), posiciones aproximadas (izquierda/centro/derecha, arriba/medio/abajo), y cualquier anomalia (negro interno, tearing, parpadeo, bandas incorrectas, corrupcion). Si analizas una secuencia, indica que cambia entre frames consecutivos. Responde breve y concreto (max 140 palabras).`;

const META_PROMPT = `Analiza este perfil de ejecucion de una demo Amiga y da un pre-analisis tecnico. Reporta: modo de pantalla (BPLCON0/1), ventana visible (DIWSTRT/STOP, DDFSTRT/STOP), punteros de bitplane y dimensiones, si la paleta/colores parecen coherentes, actividad DMA por tipo (blitter, copper, bitplane, sprite), ciclos de perfil vs idle, reparto de las muestras de CPU por seccion y por PC caliente (cpuSamples), y cualquier registro sospechoso. Concluye si el frame parece correcto o si hay indicios de problema. Breve (max 180 palabras).`;

function dmaSummaryReadable(summary: Record<string, number>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(summary)) {
    const n = Number(k);
    parts.push(`${DMA_TYPE_NAMES[n] ?? `type${n}`}=${v}`);
  }
  return parts.join(', ') || 'ninguna';
}

/** Monta los frames en una hoja de contacto con ffmpeg; null si falla. */
async function buildMontage(images: string[], outDir: string): Promise<string | null> {
  if (images.length === 0) return null;
  const montagePath = path.join(outDir, '_montage.png');
  const args = ['-y'];
  for (const img of images) args.push('-i', img);
  const grid = Math.ceil(Math.sqrt(images.length));
  const inputs = images.map((_, i) => `[${i}:v]`).join('');
  const layout: string[] = [];
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      if (r * grid + c >= images.length) break;
      layout.push(`${c === 0 ? 0 : 'w0*' + c}_${r === 0 ? 0 : 'h0*' + r}`);
    }
  }
  args.push('-filter_complex', `${inputs}xstack=inputs=${images.length}:layout=${layout.join('|')}[v]`, '-map', '[v]', '-frames:v', '1', montagePath);
  try {
    await execFileAsync('ffmpeg', args, { timeout: 60000 });
    return montagePath;
  } catch (e) {
    console.warn(`[profile-ollama] ffmpeg no disponible o fallo: ${(e as Error).message}`);
    return null;
  }
}

export async function analyzeProfile(req: ProfileOllamaRequest): Promise<string> {
  const outDir = req.outDir || path.join(os.tmpdir(), `winuae-profile-ollama-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  // 1) Captura (o usa un .bin existente).
  let binPath = req.binFile ?? '';
  if (!binPath || !fs.existsSync(binPath)) {
    binPath = path.join(outDir, 'profile.bin');
    await captureProfileSideChannel(
      req.sidePort,
      binPath,
      req.numFrames,
      req.lockOwner,
      req.waitCmd,
      req.waitContains,
      req.waitTimeoutMs
    );
    if (!fs.existsSync(binPath)) throw new Error(`no se genero el perfil: ${binPath}`);
  }

  // 2) Extraccion.
  const buffer = fs.readFileSync(binPath);
  const profile = parseProfile(buffer);
  await extractProfile(profile, outDir, path.basename(binPath));

  // 3) Analisis Ollama.
  const model = req.model || process.env.OLLAMA_MODEL || 'qwen3-vl:8b-instruct-q8_0';
  const textModel = req.textModel || process.env.OLLAMA_TEXT_MODEL || 'qwen3:8b';
  const base = req.base || process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';

  let basePrompt = DEFAULT_PROMPT;
  if (req.promptFile && fs.existsSync(req.promptFile)) {
    basePrompt = fs.readFileSync(req.promptFile, 'utf8').trim();
  } else if (req.prompt) {
    basePrompt = `${DEFAULT_PROMPT}\nRequisito extra del test: ${req.prompt}`;
  }

  const summary = buildSummary(profile, path.basename(binPath)) as {
    frames: Array<Record<string, unknown>>;
  };
  const report: string[] = [
    `# Análisis de perfil (visión ${model}, texto ${textModel})`,
    '',
    `Fuente: ${path.basename(binPath)} · ${profile.frames.length} frame(s) · salida: ${outDir}`,
    '',
  ];

  const mode = req.mode || 'all';

  // ---- Meta (texto, sin imagenes) ----
  if (mode === 'all' || mode === 'meta') {
    const metaText = JSON.stringify({
      sectionBases: summaryFramesMeta(summary),
      cpuSamples: (summary as { cpuSamples?: unknown }).cpuSamples,
    }, null, 1);
    let meta: string;
    try {
      meta = await ollamaChat(base, textModel, [{ role: 'user', content: `${META_PROMPT}\n\n${metaText}` }]);
    } catch (e) {
      meta = `(error análisis meta: ${(e as Error).message})`;
    }
    report.push('## Pre-análisis del perfil (sin imágenes)', '', meta, '');
  }

  // ---- Vision ----
  const frameIndices = profile.frames.map((_, i) => i);
  let selected = frameIndices;
  if (req.selectedFrames && req.selectedFrames.length > 0) selected = req.selectedFrames;

  const images = selected
    .filter((idx) => idx >= 0 && idx < profile.frames.length)
    .map((idx) => path.join(outDir, `frame_${String(idx).padStart(4, '0')}.${profile.frames[idx].screenshotType}`))
    .filter((p) => fs.existsSync(p));

  const wantFrames = mode === 'frames' || mode === 'all';
  const wantMontage = mode === 'montage' || mode === 'all';

  if (images.length === 0) {
    report.push('## Frames', '', '(no hay frames para analizar)', '');
  } else {
    if (wantFrames) {
      report.push('## Frames (análisis individual)', '');
      let prev = '';
      for (const img of images) {
        const baseName = path.basename(img);
        const idx = /frame_(\d+)/.exec(baseName)?.[1];
        const frameIdx = idx !== undefined ? Number(idx) : -1;
        const f = frameIdx >= 0 ? profile.frames[frameIdx] : null;
        const ctx = [
          `Frame ${baseName}.`,
          f ? `BPLCON0=${frameRegisters(f).BPLCON0} BPLCON1=${frameRegisters(f).BPLCON1} DIW=${frameRegisters(f).DIWSTRT}-${frameRegisters(f).DIWSTOP} DDF=${frameRegisters(f).DDFSTRT}-${frameRegisters(f).DDFSTOP}` : '',
          f && f.gfxResources.filter((r) => r.type === 0).length
            ? `Bitplanes: ${f.gfxResources.filter((r) => r.type === 0).map((b) => '0x' + b.address.toString(16) + ' ' + b.width + 'x' + b.height + 'x' + b.numPlanes).join(', ')}`
            : '',
          prev ? `Contexto frame anterior: ${prev}` : '',
        ].filter(Boolean).join('\n');
        const text = await ollamaChat(base, model, [{
          role: 'user',
          content: `${basePrompt}\n${ctx}`,
          images: [fs.readFileSync(img).toString('base64')],
        }]);
        prev = text;
        report.push(`### ${baseName}`, `![frame](${baseName})`, text, '');
      }
    }
    if (wantMontage) {
      report.push('## Secuencia (hoja de contacto)', '');
      const montagePath = await buildMontage(images, outDir);
      if (montagePath) {
        try {
          const grid = Math.ceil(Math.sqrt(images.length));
          const text = await ollamaChat(base, model, [{
            role: 'user',
            content: `${basePrompt}\nLa imagen es una hoja de contacto con ${images.length} frames en rejilla ${grid}x${grid} (orden de lectura: filas de arriba a abajo, izquierda a derecha). Describe que se ve en cada frame y que cambia entre ellos.`,
            images: [fs.readFileSync(montagePath).toString('base64')],
          }]);
          report.push(`![hoja de contacto](${path.basename(montagePath)})`, text, '');
        } catch (e) {
          report.push(`(error analizando el montaje: ${(e as Error).message})`, '');
        }
      } else {
        report.push('(no se pudo crear el montaje; ffmpeg no disponible)', '');
      }
    }
  }

  return report.join('\n');
}

/** Aplana el resumen para el prompt meta (sin imagenes, acotado). */
function summaryFramesMeta(summary: { frames: Array<Record<string, unknown>> }): unknown {
  return {
    frames: summary.frames.map((f) => ({
      frame: f.frame,
      registers: f.registers,
      bitplanes: f.bitplanes,
      paletteEntries: Array.isArray(f.palette) ? (f.palette as Array<{ numEntries?: number }>).map((p) => p.numEntries) : [],
      dma: f.dma,
      profileCycles: f.profileCycles,
      idleCycles: f.idleCycles,
    })),
  };
}
