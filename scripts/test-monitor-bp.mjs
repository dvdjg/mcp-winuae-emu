#!/usr/bin/env node
/**
 * Test monitor breakpoints command
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

  async sendMonitor(cmd, timeout = 10000) {
    const hexCmd = Buffer.from(cmd).toString('hex');
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
      
      let buffer = '';
      let result = '';
      
      const handler = (data) => {
        buffer += data.toString();
        
        while (true) {
          const match = buffer.match(/\$([^#]*?)#([0-9a-fA-F]{2})/);
          if (!match) break;
          
          const packetData = match[1];
          buffer = buffer.slice(match.index + match[0].length);
          this.socket.write('+');
          
          if (packetData.startsWith('O')) {
            result += Buffer.from(packetData.slice(1), 'hex').toString('utf8');
          } else if (packetData === 'OK') {
            clearTimeout(timer);
            this.socket.removeListener('data', handler);
            resolve(result);
            return;
          } else if (packetData.startsWith('E')) {
            clearTimeout(timer);
            this.socket.removeListener('data', handler);
            resolve(`Error: ${packetData}`);
            return;
          } else {
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
      
      const cs = (str) => {
        let sum = 0;
        for (let i = 0; i < str.length; i++) sum = (sum + str.charCodeAt(i)) & 0xff;
        return sum.toString(16).padStart(2, '0');
      };
      
      const fullPacket = `$qRcmd,${hexCmd}#${cs(`qRcmd,${hexCmd}`)}`;
      console.log(`Sending: monitor ${cmd}`);
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
    await new Promise(r => setTimeout(r, 500));
    
    console.log('\n=== monitor breakpoints ===');
    const result = await gdb.sendMonitor('breakpoints');
    console.log(result);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    gdb.close();
  }
}

main();
