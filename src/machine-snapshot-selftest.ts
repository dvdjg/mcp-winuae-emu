import assert from 'node:assert/strict';
import {
  buildCpuSnapshot,
  buildCustomRegisterSnapshot,
  buildMachineSnapshot,
  buildMemoryWindowSnapshot,
  CUSTOM_REGISTER_SIZE,
  MACHINE_SNAPSHOT_MEMORY_CHUNK_BYTES,
  normalizeMemoryWindow,
  readMemoryWindowChunked,
} from './machine-snapshot.js';

async function run(): Promise<void> {
  const cpu = buildCpuSnapshot({
    D0: 0x1, D1: 0x2, D2: 0x3, D3: 0x4,
    D4: 0x5, D5: 0x6, D6: 0x7, D7: 0x8,
    A0: 0x10, A1: 0x11, A2: 0x12, A3: 0x13,
    A4: 0x14, A5: 0x15, A6: 0x16, A7: 0x17,
    SR: 0x2704, PC: 0x123456,
  });
  assert.equal(cpu.D0, '$00000001');
  assert.equal(cpu.SR, '$2704');
  assert.deepEqual(cpu.SR_flags, ['S', 'IPL=7', 'x', 'n', 'Z', 'v', 'c']);

  const buffer = Buffer.alloc(CUSTOM_REGISTER_SIZE, 0);
  buffer.writeUInt16BE(0x1234, 0x100);
  buffer.writeUInt16BE(0x0F0F, 0x180);
  const custom = buildCustomRegisterSnapshot(buffer, {
    0x100: 'BPLCON0',
    0x180: 'COLOR00',
  }, [0x40]);
  assert.equal(custom.registers.BPLCON0.address, '$00DFF100');
  assert.equal(custom.registers.BPLCON0.value, '$1234');
  assert.equal(custom.unreadable_chunk_offsets[0], '$040');

  const window = normalizeMemoryWindow({ address: 0x2000, bytes: 0x5000 }, 0);
  assert.ok(window);
  assert.equal(window.bytesToRead, 0x4000);
  assert.equal(window.truncated, true);

  const memory = buildMemoryWindowSnapshot(window!, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  assert.equal(memory.address, '$00002000');
  assert.equal(memory.data_hex, 'DEADBEEF');

  const snapshot = buildMachineSnapshot({ cpu, custom, memory: { chip: memory } });
  assert.equal(snapshot.metadata.max_memory_window_bytes, 0x4000);
  assert.equal(snapshot.metadata.memory_window_chunk_bytes, MACHINE_SNAPSHOT_MEMORY_CHUNK_BYTES);
  assert.equal(snapshot.memory?.chip?.bytes_read, 4);

  const reads: Array<{ address: number; length: number }> = [];
  const chunked = await readMemoryWindowChunked({
    async readMemory(address: number, length: number): Promise<Buffer> {
      reads.push({ address, length });
      return Buffer.alloc(length, (address / 0x400) & 0xff);
    },
  }, { address: 0x4000, requestedBytes: 0x900, bytesToRead: 0x900, truncated: false }, 0x400);
  assert.equal(chunked.length, 0x900);
  assert.deepEqual(reads, [
    { address: 0x4000, length: 0x400 },
    { address: 0x4400, length: 0x400 },
    { address: 0x4800, length: 0x100 },
  ]);

  console.log('machine-snapshot self-test OK');
}

await run();
