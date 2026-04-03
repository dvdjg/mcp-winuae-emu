import assert from 'node:assert/strict';
import {
  buildBitmapDecodeResponse,
  decodePlanarBitmap,
  encodePngRgba,
  normalizeBitmapDecodeRequest,
  rgbaToHex,
} from './bitmap-decode.js';

function run(): void {
  const request = normalizeBitmapDecodeRequest({
    width: 8,
    height: 1,
    depth: 4,
    layout: 'interleaved',
    palette: ['#000000', '#110000', '#220000', '#330000', '#440000', '#550000', '#660000', '#770000',
      '#880000', '#990000', '#AA0000', '#BB0000', '#CC0000', '#DD0000', '#EE0000', '#FF0000'],
  });

  const interleaved = Buffer.from([
    0x55, 0x00,
    0x33, 0x00,
    0x0f, 0x00,
    0x00, 0x00,
  ]);

  const decoded = decodePlanarBitmap(interleaved, {
    width: request.width,
    height: request.height,
    depth: request.depth,
    rowBytes: request.rowBytes,
    layout: request.layout,
    colorMode: request.colorMode,
  }, undefined, ['#000000', '#110000', '#220000', '#330000', '#440000', '#550000', '#660000', '#770000',
    '#880000', '#990000', '#AA0000', '#BB0000', '#CC0000', '#DD0000', '#EE0000', '#FF0000']);

  assert.deepEqual(decoded.palette_hex.slice(0, 8), [
    '#000000', '#110000', '#220000', '#330000',
    '#440000', '#550000', '#660000', '#770000',
  ]);
  assert.equal(decoded.rgba[0], 0x00);
  assert.equal(decoded.rgba[4], 0x11);
  assert.equal(decoded.rgba[8], 0x22);
  assert.equal(decoded.rgba[12], 0x33);

  const png = encodePngRgba(decoded.width, decoded.height, decoded.rgba);
  assert.equal(png.subarray(0, 8).toString('hex').toUpperCase(), '89504E470D0A1A0A');

  const response = buildBitmapDecodeResponse(decoded, 0x4000, 'C:\\temp\\bitmap.png', rgbaToHex(decoded.rgba));
  assert.equal(response.bitmap.address, '$00004000');
  assert.equal(response.png_file, 'C:\\temp\\bitmap.png');
  assert.ok(response.rgba_hex?.startsWith('000000FF'));

  console.log('bitmap-decode self-test OK');
}

run();
