import assert from 'node:assert/strict';
import { isAmigaHunkExecutable, loadAmigaHunk } from './amiga-hunk.js';

function buildFixture(): Buffer {
  const words = [
    0x000003f3, // HUNK_HEADER
    0x00000000, // no resident names
    0x00000002, // hunk count
    0x00000000, // first hunk
    0x00000001, // last hunk
    0x00000001, // hunk0 size longwords
    0x00000001, // hunk1 size longwords

    0x000003e9, // HUNK_CODE
    0x00000001, // 1 longword
    0x00000000, // code word needing reloc
    0x000003ec, // HUNK_RELOC32
    0x00000001, // one reloc
    0x00000001, // target hunk 1
    0x00000000, // offset 0
    0x00000000, // end reloc list
    0x000003f2, // HUNK_END

    0x000003ea, // HUNK_DATA
    0x00000001, // 1 longword
    0x12345678, // data
    0x000003f2, // HUNK_END
  ];

  const buffer = Buffer.alloc(words.length * 4);
  words.forEach((word, i) => buffer.writeUInt32BE(word >>> 0, i * 4));
  return buffer;
}

function run(): void {
  const fixture = buildFixture();
  assert.equal(isAmigaHunkExecutable(fixture), true);

  const loaded = loadAmigaHunk(fixture, 0x4000);
  assert.equal(loaded.entryAddress, 0x4000);
  assert.equal(loaded.hunks.length, 2);
  assert.equal(loaded.hunks[1].baseAddress, 0x4004);
  assert.equal(loaded.totalBytes, 8);
  assert.equal(loaded.hunks[0].data.readUInt32BE(0), 0x4004);
  assert.equal(loaded.hunks[1].data.readUInt32BE(0), 0x12345678);

  console.log('amiga-hunk self-test OK');
}

run();
