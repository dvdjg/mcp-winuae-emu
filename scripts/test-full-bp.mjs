#!/usr/bin/env node
/**
 * Test full breakpoint flow: qOffsets -> Z0 (set breakpoint) -> monitor breakpoints
 */

import net from 'net';

const GDB_PORT = 2345;

class SimpleGDB {
  constructor() {
    this.socket = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port: GDB_PORT, host: 'localhost' });
      this.socket.setTimeout(5000);
      this.socket.on('connect', () => {
        console.log('Connected to GDB server');
        resolve();
      });
      this.socket.on('error', reject);
      this.socket.on('timeout', () => reject(new Error('Connection timeout')));
    });
  }

  async sendPacket(packet, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
      
      let buffer = '';
      let outputText = '';
      
      const handler = (data) => {
        buffer += data.toString();
        
        while (true) {
          const match = buffer.match(/\$([^#]*?)#([0-9a-fA-F]{2})/);
          if (!match) break;
          
          const pktData = match[1];
          buffer = buffer.slice(match.index + match[0].length);
          this.socket.write('+');
          
          if (pktData.startsWith('O')) {
            outputText += Buffer.from(pktData.slice(1), 'hex').toString('utf8');
            continue;
          }
          
          clearTimeout(timer);
          this.socket.removeListener('data', handler);
          resolve({ response: pktData, output: outputText });
          return;
        }
      };
      
      this.socket.on('data', handler);
      
      const cs = (str) => {
        let sum = 0;
        for (let i = 0; i < str.length; i++) sum = (sum + str.charCodeAt(i)) & 0xff;
        return sum.toString(16).padStart(2, '0');
      };
      
      const fullPacket = `$${packet}#${cs(packet)}`;
      this.socket.write(fullPacket);
    });
  }

  async sendMonitor(cmd) {
    const hexCmd = Buffer.from(cmd).toString('hex');
    const result = await this.sendPacket(`qRcmd,${hexCmd}`, 10000);
    const decoded = Buffer.from(result.response, 'hex').toString('utf8');
    return decoded || result.response;
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
    }
  }
}

async function main() {
  const gdb = new SimpleGDB();
  
  try {
    await gdb.connect();
    await new Promise(r => setTimeout(r, 500));
    
    // Step 1: Call qOffsets to get baseText
    console.log('\n=== 1. qOffsets ===');
    const offsets = await gdb.sendPacket('qOffsets', 10000);
    console.log('qOffsets response:', offsets.response);
    
    // Parse baseText from response (format: addr1;addr2;... without leading $)
    if (offsets.response && !offsets.response.startsWith('E')) {
      const addrs = offsets.response.split(';');
      const baseText = parseInt(addrs[0], 16);
      const ELF_TEXT_BASE = 0x400;
      const loadOffset = baseText - ELF_TEXT_BASE;
      console.log(`baseText = 0x${baseText.toString(16).toUpperCase()}`);
      console.log(`loadOffset = 0x${loadOffset.toString(16).toUpperCase()}`);
      
      // Step 2: Set breakpoint using ELF address
      // intuition_calc_loop is at 0x16f6 in ELF
      const elfAddr = 0x16f6;
      console.log(`\n=== 2. Setting breakpoint at ELF 0x${elfAddr.toString(16)} ===`);
      const bp = await gdb.sendPacket(`Z0,${elfAddr.toString(16)},2`, 5000);
      console.log('Z0 response:', bp.response);
      
      // Step 3: Check breakpoints
      console.log('\n=== 3. monitor breakpoints ===');
      const bpList = await gdb.sendMonitor('breakpoints');
      console.log(bpList);
      
    } else if (offsets.response === 'E01') {
      console.log('ERROR: qOffsets returned E01');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    gdb.close();
  }
}

main();
