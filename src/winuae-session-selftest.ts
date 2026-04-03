import assert from 'node:assert/strict';
import { WinUAEConnection } from './winuae-connection.js';

function run(): void {
  const conn = new WinUAEConnection({
    winuaePath: 'C:\\temp\\winuae',
    configFile: 'C:\\temp\\config.uae',
    gdbPort: 2345,
  });

  let info = conn.getSessionInfo();
  assert.equal(info.connected, false);
  assert.equal(info.idleTimeoutMs, 0);
  assert.equal(info.idleAction, 'detach');

  conn.setSessionIdlePolicy(15000, 'shutdown');
  conn.markActivity('selftest');

  info = conn.getSessionInfo();
  assert.equal(info.idleTimeoutMs, 15000);
  assert.equal(info.idleAction, 'shutdown');
  assert.equal(info.lastActivityReason, 'selftest');
  assert.ok(info.lastActivityAt);

  console.log('winuae-session self-test OK');
}

run();
