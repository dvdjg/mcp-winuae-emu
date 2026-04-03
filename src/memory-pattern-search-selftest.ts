import assert from 'node:assert/strict';
import {
  buildMemoryPatternSearchResponse,
  normalizeMemoryPatternSearchRequest,
  searchMemoryPattern,
} from './memory-pattern-search.js';

function run(): void {
  const haystack = Buffer.from(
    '00112233445566778899AABBCCDDEEFFAABBCCDD0011AABBCCDD0011AABBCCDD0011',
    'hex'
  );

  const exactRequest = normalizeMemoryPatternSearchRequest({
    address: 0x4000,
    length: haystack.length,
    patternHex: 'AABBCCDD0011',
    maxResults: 4,
  });
  const exactMatches = searchMemoryPattern(haystack, exactRequest);
  assert.equal(exactMatches.length, 3);
  assert.equal(exactMatches[0].address, '$00004010');

  const strideRequest = normalizeMemoryPatternSearchRequest({
    address: 0x4000,
    length: haystack.length,
    patternHex: 'AABBCCDD0011',
    strideBytes: 6,
    repeatCount: 3,
    maxResults: 4,
  });
  const strideMatches = searchMemoryPattern(haystack, strideRequest);
  assert.equal(strideMatches[0].matched_rows, 3);
  assert.equal(strideMatches[0].score, 1);

  const response = buildMemoryPatternSearchResponse(strideRequest, strideMatches);
  assert.equal(response.search.stride_bytes, 6);
  assert.equal(response.candidates[0].address, '$00004010');

  console.log('memory-pattern-search self-test OK');
}

run();
