#!/usr/bin/env node
/**
 * Test the new 'monitor findproc' command
 * Connects to existing WinUAE GDB server and sends the findproc command
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
      const handler = (data) => {
        buffer += data.toString();
        // Look for complete packet: $..#..
        const match = buffer.match(/\$([^#]*?)#([0-9a-fA-F]{2})/);
        if (match) {
          clearTimeout(timer);
          this.socket.removeListener('data', handler);
          resolve(match[1]);
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

  async sendMonitor(cmd) {
    const hexCmd = Buffer.from(cmd).toString('hex');
    
    return new Promise((resolve, reject) => {
      const timeout = 10000;
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
      
      let buffer = '';
      let result = '';
      
      const handler = (data) => {
        buffer += data.toString();
        
        // Process all complete packets in buffer
        while (true) {
          // Look for complete packet: $..#..
          const match = buffer.match(/\$([^#]*?)#([0-9a-fA-F]{2})/);
          if (!match) break;
          
          const packetData = match[1];
          buffer = buffer.slice(match.index + match[0].length);
          
          // Send ACK
          this.socket.write('+');
          
          if (packetData.startsWith('O')) {
            // Output packet - decode and accumulate
            result += Buffer.from(packetData.slice(1), 'hex').toString('utf8');
          } else if (packetData === 'OK') {
            // Command completed
            clearTimeout(timer);
            this.socket.removeListener('data', handler);
            resolve(result);
            return;
          } else if (packetData.startsWith('E')) {
            // Error
            clearTimeout(timer);
            this.socket.removeListener('data', handler);
            resolve(`Error: ${packetData}`);
            return;
          } else {
            // Other packet - try to decode as hex
            const decoded = Buffer.from(packetData, 'hex').toString('utf8');
            result += decoded;
            clearTimeout(timer);
            this.socket.removeListener('data', handler);
            resolve(result);
            return;
          }
        }
      };
      
      this.socket.on('data', handler);
      
      // Send the packet
      const fullPacket = `$qRcmd,${hexCmd}#${this.checksum(`qRcmd,${hexCmd}`)}`;
      console.log(`Sending: ${fullPacket}`);
      this.socket.write(fullPacket);
    });
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
    
    // Send monitor findproc
    console.log('\n=== Sending: monitor findproc ===');
    const result = await gdb.sendMonitor('findproc');
    console.log('Response:');
    console.log(result);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    gdb.close();
  }
}

main();
