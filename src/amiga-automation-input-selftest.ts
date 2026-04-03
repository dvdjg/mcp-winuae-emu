import assert from 'node:assert/strict';
import {
  applyAutomationInputPatch,
  AUTOMATION_INPUT_SIZE,
  buildAutomationInputResponse,
  decodeAutomationInput,
} from './amiga-automation-input.js';

function run(): void {
  const buffer = Buffer.alloc(AUTOMATION_INPUT_SIZE, 0);
  buffer[18] = 0xFF;

  applyAutomationInputPatch(buffer, {
    enabled: true,
    mouse_left: true,
    mouse_x: 200,
    mouse_y: 120,
    joy0_right: true,
    keycode: 0x45,
  });

  const decoded = decodeAutomationInput(buffer);
  assert.equal(decoded.enabled, true);
  assert.equal(decoded.mouseLeft, true);
  assert.equal(decoded.mouseX, 200);
  assert.equal(decoded.mouseY, 120);
  assert.equal(decoded.joy0.right, true);
  assert.equal(decoded.keycode, 0x45);

  applyAutomationInputPatch(buffer, {
    clear_key: true,
    mouse_right: true,
  });

  const response = buildAutomationInputResponse(0x15190, buffer);
  assert.equal((response.address as string), '$00015190');
  assert.equal((response.state as { mouseRight: boolean }).mouseRight, true);
  assert.equal((response.state as { keycode: number | null }).keycode, null);

  console.log('amiga-automation-input self-test OK');
}

run();
