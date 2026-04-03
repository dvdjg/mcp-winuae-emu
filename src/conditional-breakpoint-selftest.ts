import assert from 'node:assert/strict';
import {
  buildConditionalBreakpointResponse,
  evaluateConditionalBreakpoint,
  normalizeConditionalBreakpointRequest,
} from './conditional-breakpoint.js';

function run(): void {
  const request = normalizeConditionalBreakpointRequest({
    address: '$4000',
    register_equals: { D0: '$12' },
    register_mask_equals: [{ register: 'SR', mask: '$2000', value: '$2000' }],
    memory_equals: [{ address: '$5000', value_hex: 'DE AD BE EF' }],
    custom_equals: [{ name: 'DMACON', value: '$83C0' }],
    max_hits: 8,
  }, {
    0x096: 'DMACON',
  });

  assert.equal(request.address, 0x4000);
  assert.equal(request.customEquals[0].offset, 0x096);
  assert.equal(request.memoryEquals[0].value.toString('hex').toUpperCase(), 'DEADBEEF');

  const custom = Buffer.alloc(0x200, 0);
  custom.writeUInt16BE(0x83C0, 0x096);

  const evaluation = evaluateConditionalBreakpoint(request, {
    registers: {
      D0: 0x12, D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0, D7: 0,
      A0: 0, A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0, A7: 0,
      SR: 0x2000, PC: 0x4000,
    },
    customData: custom,
    memoryByAddress: new Map([[0x5000, Buffer.from('DEADBEEF', 'hex')]]),
  });

  assert.equal(evaluation.matched, true);
  assert.equal(evaluation.clauses.length, 4);

  const response = buildConditionalBreakpointResponse({
    request,
    hits: 3,
    matched: true,
    stopReply: 'T05swbreak:;',
    breakpointCleared: true,
    registers: {
      D0: 0x12, D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0, D7: 0,
      A0: 0, A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0, A7: 0,
      SR: 0x2000, PC: 0x4000,
    },
    evaluation,
  });

  assert.equal(response.implementation, 'software-assisted');
  assert.equal((response.breakpoint as { address: string }).address, '$00004000');
  assert.equal((response.conditions as Array<{ passed: boolean }>)[0].passed, true);

  console.log('conditional-breakpoint self-test OK');
}

run();
