#!/usr/bin/env node
/**
 * diagnose-debug.mjs - Script de diagnóstico para depuración de Amiga
 * 
 * Verifica:
 * 1. Conexión con WinUAE-DBG
 * 2. Respuesta de qOffsets y cálculo de baseText
 * 3. Estado de breakpoints
 * 4. Información de registros
 * 
 * Uso: node scripts/diagnose-debug.mjs [--port 2345] [--host 127.0.0.1]
 */

import { Socket } from 'net';

const args = process.argv.slice(2);
const host = args.includes('--host') ? args[args.indexOf('--host') + 1] : '127.0.0.1';
const port = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1]) : 2345;

const ELF_TEXT_BASE = 0x400;

class GdbDiagnostic {
  constructor() {
    this.socket = null;
    this.buffer = '';
    this.noAckMode = false;
    this.resolvers = [];
  }

  async connect() {
    console.log(`\n=== Diagnóstico de Depuración Amiga ===`);
    console.log(`Conectando a ${host}:${port}...`);
    
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      const timeout = setTimeout(() => {
        reject(new Error('Timeout de conexión (5s). ¿Está WinUAE ejecutándose con gdbserver?'));
      }, 5000);
      
      this.socket.connect(port, host, () => {
        clearTimeout(timeout);
        console.log('✓ Conexión TCP establecida');
        resolve();
      });
      
      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      this.socket.on('data', (data) => this.handleData(data));
    });
  }

  handleData(data) {
    this.buffer += data.toString('binary');
    
    while (this.buffer.length > 0) {
      if (this.buffer[0] === '+' || this.buffer[0] === '-') {
        this.buffer = this.buffer.slice(1);
        continue;
      }
      
      const dollarIdx = this.buffer.indexOf('$');
      if (dollarIdx === -1) {
        this.buffer = '';
        break;
      }
      if (dollarIdx > 0) this.buffer = this.buffer.slice(dollarIdx);
      
      const hashIdx = this.buffer.indexOf('#');
      if (hashIdx === -1 || hashIdx + 2 >= this.buffer.length) break;
      
      const packetData = this.buffer.slice(1, hashIdx);
      this.buffer = this.buffer.slice(hashIdx + 3);
      
      if (!this.noAckMode) this.socket.write('+');
      
      // Skip O packets (console output)
      if (packetData.startsWith('O') && packetData.length > 2 && /^O[0-9a-fA-F]+$/.test(packetData)) {
        continue;
      }
      
      const resolver = this.resolvers.shift();
      if (resolver) {
        clearTimeout(resolver.timer);
        resolver.resolve(packetData);
      }
    }
  }

  computeChecksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data.charCodeAt(i);
    return sum & 0xFF;
  }

  async sendCommand(cmd, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.resolvers.findIndex(r => r.resolve === resolve);
        if (idx >= 0) this.resolvers.splice(idx, 1);
        reject(new Error(`Timeout: ${cmd}`));
      }, timeoutMs);
      
      this.resolvers.push({ resolve, reject, timer });
      const checksum = this.computeChecksum(cmd);
      this.socket.write(`$${cmd}#${checksum.toString(16).padStart(2, '0')}`);
    });
  }

  async sendMonitor(cmd) {
    const hex = Buffer.from(cmd, 'utf8').toString('hex');
    const reply = await this.sendCommand(`qRcmd,${hex}`);
    if (reply === 'OK') return 'OK';
    if (reply.startsWith('E')) throw new Error(`Monitor error: ${reply}`);
    return Buffer.from(reply, 'hex').toString('utf8');
  }

  async runDiagnostics() {
    try {
      // 1. Handshake
      console.log('\n--- Handshake GDB ---');
      const supported = await this.sendCommand('qSupported:multiprocess+;swbreak+;hwbreak+');
      console.log(`qSupported: ${supported.slice(0, 80)}...`);
      
      // Enable no-ack mode
      const ackReply = await this.sendCommand('QStartNoAckMode');
      if (ackReply === 'OK') {
        this.noAckMode = true;
        console.log('✓ No-ack mode habilitado');
      }
      
      // 2. Halt reason
      const haltReason = await this.sendCommand('?');
      console.log(`Razón de parada: ${haltReason}`);
      
      // 3. qOffsets - Critical for breakpoint relocation
      console.log('\n--- qOffsets (baseText) ---');
      const offsets = await this.sendCommand('qOffsets');
      console.log(`Respuesta qOffsets: ${offsets}`);
      
      // Parse offsets (Bartman format: semicolon-separated hex addresses)
      if (offsets && !offsets.startsWith('E')) {
        const sections = offsets.split(';').map(s => parseInt(s, 16));
        const baseText = sections[0] || 0;
        const loadOffset = baseText >= ELF_TEXT_BASE ? baseText - ELF_TEXT_BASE : 0;
        
        console.log(`  baseText = 0x${baseText.toString(16)}`);
        console.log(`  loadOffset = 0x${loadOffset.toString(16)}`);
        console.log(`  sections = [${sections.map(s => '0x' + s.toString(16)).join(', ')}]`);
        
        if (baseText === 0 || baseText < 0x1000) {
          console.log('⚠ PROBLEMA: baseText es 0 o muy bajo - los breakpoints no funcionarán correctamente');
        } else if (baseText > 0xC00000) {
          console.log('✓ baseText parece correcto (Fast RAM)');
        } else if (baseText > 0x1000 && baseText < 0x200000) {
          console.log('✓ baseText parece correcto (Chip RAM)');
        }
      } else {
        console.log('⚠ ERROR: qOffsets devolvió error');
      }
      
      // 4. Registers
      console.log('\n--- Registros CPU ---');
      const regs = await this.sendCommand('g');
      if (regs.length >= 144) {
        const pc = parseInt(regs.slice(17*8, 18*8), 16);
        const sp = parseInt(regs.slice(15*8, 16*8), 16);
        const sr = parseInt(regs.slice(16*8, 17*8), 16);
        console.log(`  PC = 0x${pc.toString(16)}`);
        console.log(`  SP = 0x${sp.toString(16)}`);
        console.log(`  SR = 0x${sr.toString(16)}`);
        
        // Check if PC is in ROM
        if (pc >= 0xF80000) {
          console.log('  (PC está en ROM - sistema en espera o idle)');
        } else if (pc >= 0xC00000) {
          console.log('  (PC está en Fast RAM - probable código de usuario)');
        } else if (pc < 0x200000) {
          console.log('  (PC está en Chip RAM - probable código de usuario)');
        }
      }
      
      // 5. Monitor offset status
      console.log('\n--- Monitor offset ---');
      try {
        const offsetInfo = await this.sendMonitor('offset');
        console.log(`  ${offsetInfo}`);
      } catch (e) {
        console.log(`  Error: ${e.message}`);
      }
      
      // 6. Monitor breakpoints
      console.log('\n--- Breakpoints activos ---');
      try {
        const bpInfo = await this.sendMonitor('breakpoints');
        console.log(bpInfo);
      } catch (e) {
        console.log(`  Error: ${e.message}`);
      }
      
      // 7. Check version
      console.log('\n--- Versión WinUAE-DBG ---');
      const version = supported.match(/WinUAE-DBG[^;]*/);
      if (version) console.log(`  ${version[0]}`);
      else console.log('  (versión no disponible en qSupported)');
      
      console.log('\n=== Diagnóstico completado ===\n');
      
    } catch (err) {
      console.error(`\n✗ Error: ${err.message}\n`);
    } finally {
      if (this.socket) this.socket.destroy();
    }
  }
}

async function main() {
  const diag = new GdbDiagnostic();
  try {
    await diag.connect();
    await diag.runDiagnostics();
  } catch (err) {
    console.error(`\n✗ Error de conexión: ${err.message}`);
    console.error('\nPosibles causas:');
    console.error('  1. WinUAE no está ejecutándose');
    console.error('  2. gdbserver no está habilitado en WinUAE');
    console.error('  3. El puerto 2345 está bloqueado o en uso');
    console.error('\nPara habilitar gdbserver, ejecute WinUAE con:');
    console.error('  -s debugging_features=gdbserver\n');
    process.exit(1);
  }
}

main();
