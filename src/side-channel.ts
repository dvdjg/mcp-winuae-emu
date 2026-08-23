/**
 * Client for the WinUAE-DBG AMG side channel (localhost, line-based TCP).
 * Independent of the GDB RSP connection: useful when GDB is unavailable or
 * inert (e.g. after a rewind restore), or for low-friction observation.
 *
 * Protocol (one command per line, one JSON reply per line):
 *   hello | state | regs | mem <hex-addr> <len> | runstatus <hex-addr>
 */
import net from 'net';

export interface SideChannelReply {
  ok: boolean;
  command: string;
  reply?: Record<string, unknown>;
  raw?: string;
  error?: string;
}

export async function sideChannelCommand(
  command: string,
  port = 2346,
  timeoutMs = 4000,
): Promise<SideChannelReply> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let pending = '';
    const lines: string[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: false, command, error: 'timeout', raw: lines.join('\n') });
    }, timeoutMs);
    const finish = (r: SideChannelReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      pending += chunk;
      for (;;) {
        const eol = pending.indexOf('\n');
        if (eol < 0) break;
        lines.push(pending.slice(0, eol).trim());
        pending = pending.slice(eol + 1);
      }
      // The server sends a "connected" greeting first; the command reply is a
      // separate JSON line (not the greeting).
      const reply = lines.find((l) => l.startsWith('{') && !l.includes('"event":"connected"'));
      if (reply) {
        socket.destroy();
        try {
          finish({ ok: true, command, reply: JSON.parse(reply), raw: reply });
        } catch {
          finish({ ok: true, command, raw: reply });
        }
      }
    });
    socket.on('error', (e) => finish({ ok: false, command, error: e.message }));
    socket.connect(port, '127.0.0.1', () => socket.write(`${command}\n`));
  });
}
