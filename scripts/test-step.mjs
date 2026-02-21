#!/usr/bin/env node
// Test script to debug the single-step protocol flow
import net from 'net';

const PORT = 2345;
const HOST = '127.0.0.1';

function computeChecksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  return sum & 0xFF;
}

function sendPacket(socket, data) {
  const checksum = computeChecksum(data);
  const packet = `$${data}#${checksum.toString(16).padStart(2, '0')}`;
  console.log(`TX: ${packet}`);
  socket.write(packet);
}

function parsePackets(data) {
  const packets = [];
  let remaining = data;
  
  while (remaining.length > 0) {
    // Check for ACK/NACK
    if (remaining[0] === '+') {
      packets.push({ type: 'ack', raw: '+' });
      remaining = remaining.slice(1);
      continue;
    }
    if (remaining[0] === '-') {
      packets.push({ type: 'nack', raw: '-' });
      remaining = remaining.slice(1);
      continue;
    }
    
    // Check for packet
    if (remaining[0] === '$') {
      const hashIdx = remaining.indexOf('#');
      if (hashIdx !== -1 && hashIdx + 2 < remaining.length) {
        const packetData = remaining.slice(1, hashIdx);
        const checksum = remaining.slice(hashIdx + 1, hashIdx + 3);
        packets.push({ type: 'packet', data: packetData, checksum, raw: remaining.slice(0, hashIdx + 3) });
        remaining = remaining.slice(hashIdx + 3);
        continue;
      }
    }
    
    // Unknown data
    packets.push({ type: 'unknown', raw: remaining });
    break;
  }
  
  return packets;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Connecting to ${HOST}:${PORT}...`);
  
  const socket = net.createConnection({ host: HOST, port: PORT }, () => {
    console.log('Connected!');
  });
  
  socket.setEncoding('binary');
  
  let receivedData = '';
  let resolveNextData = null;
  
  socket.on('data', (data) => {
    const timestamp = new Date().toISOString().split('T')[1];
    console.log(`[${timestamp}] RX raw: ${JSON.stringify(data)}`);
    
    const packets = parsePackets(data);
    for (const pkt of packets) {
      if (pkt.type === 'ack') {
        console.log(`  -> ACK (+)`);
      } else if (pkt.type === 'nack') {
        console.log(`  -> NACK (-)`);
      } else if (pkt.type === 'packet') {
        console.log(`  -> PACKET: ${pkt.data}`);
        // Send ACK for received packet
        socket.write('+');
      } else {
        console.log(`  -> UNKNOWN: ${pkt.raw}`);
      }
    }
    
    receivedData += data;
    if (resolveNextData) {
      resolveNextData(data);
      resolveNextData = null;
    }
  });
  
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
  
  socket.on('close', () => {
    console.log('Connection closed');
  });
  
  // Wait for connection
  await sleep(500);
  
  // Read registers first (to establish baseline)
  console.log('\n=== Reading registers ===');
  sendPacket(socket, 'g');
  await sleep(1000);
  
  // Now try single-step
  console.log('\n=== Sending vCont;s (single-step) ===');
  const stepStartTime = Date.now();
  sendPacket(socket, 'vCont;s');
  
  // Wait for response
  console.log('Waiting for response...');
  
  // Wait up to 5 seconds
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (receivedData.includes('S05') || receivedData.includes('T05')) {
      console.log(`Got stop reply after ${Date.now() - stepStartTime}ms`);
      break;
    }
  }
  
  console.log('\n=== All received data ===');
  console.log(JSON.stringify(receivedData));
  
  // Close connection
  await sleep(500);
  socket.end();
  process.exit(0);
}

main().catch(console.error);
