#!/usr/bin/env node
/** Lanza WinUAE como F5 (default.uae + startup-sequence) sin GDB. */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const EXT = process.env.WINUAE_CWD || 'C:/Users/David/.cursor/extensions/bartmanabyss.amiga-debug-1.8.2/bin/win32';
const AMIGA_C = process.env.AMIGA_C_ROOT || 'C:/Users/David/Documents/Programa/Amiga/Amiga-C';
const DH0 = path.join(EXT, '../dh0');
const CFG_SRC = path.join(AMIGA_C, 'config/mcp-amiga-c-debug.uae');
const STARTUP = path.join(DH0, 's/startup-sequence');

fs.writeFileSync(STARTUP, 'cd dh1:\n:a.exe\n', 'utf8');
fs.copyFileSync(CFG_SRC, path.join(EXT, 'default.uae'));

const exe = path.join(EXT, 'winuae-gdb.exe');
console.log(`Launch ${exe} -portable (cwd ${EXT})`);
const child = spawn(exe, ['-portable'], { cwd: EXT, stdio: 'ignore', detached: true });
child.unref();
console.log('WinUAE started — espera ~30s y ejecuta test-amiga-c-bp-vars-after-f5.mjs');
