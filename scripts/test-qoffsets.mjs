#!/usr/bin/env node
/**
 * Test qOffsets command
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

  async sendAndWait(packet, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for response')), timeout);
      
      let buffer = '';
      let outputText = '';
      const handler = (data) => {
        buffer += data.toString();
        
        // Process all complete packets
        while (true) {
          const match = buffer.match(/\$([^#]*?)#([0-9a-fA-F]{2})/);
          if (!match) break;
          
          const pktData = match[1];
          buffer = buffer.slice(match.index + match[0].length);
          this.socket.write('+'); // ACK
          
          // Skip 'O' output packets (debug messages)
          if (pktData.startsWith('O')) {
            const decoded = Buffer.from(pktData.slice(1), 'hex').toString('utf8');
            outputText += decoded;
            console.log('Server output:', decoded.trim());
            continue;
          }
          
          // This is the actual response
          clearTimeout(timer);
          this.socket.removeListener('data', handler);
          resolve(pktData);
          return;
        }
      };
      
      this.socket.on('data', handler);
      
      // Send the packet
      const fullPacket = `$${packet}#${this.checksum(packet)}`;
      console.log(`Sending: ${fullPacket}`);
      this.socket.write(fullPacket);
    });
  }

  checksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data.charCodeAt(i)) & 0xff;
    }
    return sum.toString(16).padStart(2, '0');
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
    
    // Read any initial data
    await new Promise(r => setTimeout(r, 500));
    
    // Send qOffsets
    console.log('\n=== Sending: qOffsets ===');
    const result = await gdb.sendAndWait('qOffsets', 10000);
    console.log('Response:', result);
    
    // Parse the response
    if (result.startsWith('$')) {
      // Response is $addr1;addr2;addr3...
      const addrs = result.slice(1).split(';');
      console.log('\nSection addresses:');
      addrs.forEach((addr, i) => {
        const num = parseInt(addr, 16);
        console.log(`  Hunk ${i}: 0x${num.toString(16).toUpperCase()} (${num})`);
      });
      
      if (addrs.length > 0) {
        const textBase = parseInt(addrs[0], 16);
        const ELF_TEXT_BASE = 0x400;
        const loadOffset = textBase - ELF_TEXT_BASE;
        console.log(`\nCalculated loadOffset: 0x${loadOffset.toString(16).toUpperCase()} (${loadOffset})`);
      }
    } else if (result === 'E01') {
      console.log('ERROR: qOffsets returned E01 (process not found or no segments)');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    gdb.close();
  }
}

main();
