/**
 * GDB Remote Serial Protocol (RSP) client for BartmanAbyss WinUAE fork
 * Handles packet framing, checksum, ack mode, and all m68k debug commands
 */

import { Socket } from 'net';

// m68k register layout in GDB order (18 regs × 4 bytes each, big-endian)
export interface M68kRegisters {
  D0: number; D1: number; D2: number; D3: number;
  D4: number; D5: number; D6: number; D7: number;
  A0: number; A1: number; A2: number; A3: number;
  A4: number; A5: number; A6: number; A7: number;
  SR: number; PC: number;
}

export type WatchpointType = 'write' | 'read' | 'access';

const REGISTER_NAMES: (keyof M68kRegisters)[] = [
  'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'SR', 'PC',
];

const WATCHPOINT_TYPE_MAP: Record<WatchpointType, number> = {
  write: 2,
  read: 3,
  access: 4,
};

export class GdbProtocol {
  private socket: Socket | null = null;
  private receiveBuffer = '';
  private noAckMode = false;
  private packetResolvers: Array<{
    resolve: (data: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private debugMode = process.env.WINUAE_DEBUG === '1';
  private pendingData = '';
  private _isRunning = false;
  private pendingStopReply: string | null = null;

  /**
   * Connect to GDB server and perform handshake
   */
  async connect(host: string, port: number): Promise<void> {
    this.socket = new Socket();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('GDB connection timeout'));
      }, 5000);

      this.socket!.connect(port, host, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('error', (err) => {
      this.debug(`[GDB] Socket error: ${err.message}`);
      this.rejectAll(new Error(`Socket error: ${err.message}`));
    });
    this.socket.on('close', () => {
      this.debug('[GDB] Socket closed');
      this.rejectAll(new Error('Socket closed'));
    });

    // Handshake: feature negotiation
    const supported = await this.sendCommand('qSupported:multiprocess+;swbreak+;hwbreak+');
    this.debug(`[GDB] qSupported response: ${supported}`);

    // Try to enable no-ack mode for speed
    try {
      const ackReply = await this.sendCommand('QStartNoAckMode');
      if (ackReply === 'OK') {
        this.noAckMode = true;
        this.debug('[GDB] No-ack mode enabled');
      }
    } catch {
      this.debug('[GDB] No-ack mode not supported, continuing with acks');
    }

    // Query halt reason
    const haltReason = await this.sendCommand('?');
    this.debug(`[GDB] Halt reason: ${haltReason}`);
  }

  /**
   * Handle incoming TCP data
   */
  private handleData(data: Buffer): void {
    this.pendingData += data.toString('binary');

    while (this.pendingData.length > 0) {
      // Handle ack/nack bytes
      if (this.pendingData[0] === '+') {
        this.pendingData = this.pendingData.slice(1);
        continue;
      }
      if (this.pendingData[0] === '-') {
        this.debug('[GDB] Received NACK');
        this.pendingData = this.pendingData.slice(1);
        continue;
      }

      // Look for packet start
      const dollarIdx = this.pendingData.indexOf('$');
      if (dollarIdx === -1) {
        // No packet start found, discard
        this.pendingData = '';
        break;
      }

      // Skip any bytes before $
      if (dollarIdx > 0) {
        this.pendingData = this.pendingData.slice(dollarIdx);
      }

      // Look for packet end (#XX)
      const hashIdx = this.pendingData.indexOf('#');
      if (hashIdx === -1 || hashIdx + 2 >= this.pendingData.length) {
        // Incomplete packet, wait for more data
        break;
      }

      // Extract packet
      const packetData = this.pendingData.slice(1, hashIdx); // between $ and #
      const checksumStr = this.pendingData.slice(hashIdx + 1, hashIdx + 3);
      this.pendingData = this.pendingData.slice(hashIdx + 3);

      // Verify checksum
      const expectedChecksum = parseInt(checksumStr, 16);
      const actualChecksum = this.computeChecksum(packetData);

      if (expectedChecksum !== actualChecksum) {
        this.debug(`[GDB] Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
        if (!this.noAckMode) {
          this.socketWrite('-');
        }
        continue;
      }

      // Send ack
      if (!this.noAckMode) {
        this.socketWrite('+');
      }

      this.debug(`[GDB] [RECV] ${packetData.slice(0, 100)}${packetData.length > 100 ? '...' : ''}`);

      // O packets are async console output from GDB server -- log and skip
      if (packetData.startsWith('O')) {
        try {
          const hexText = packetData.slice(1);
          const text = Buffer.from(hexText, 'hex').toString('utf8').trim();
          this.debug(`[GDB] Server output: ${text}`);
        } catch {
          this.debug(`[GDB] Server output (raw): ${packetData.slice(1, 50)}`);
        }
        continue;
      }

      // Async stop replies (S/T packets) when CPU was running with no resolver waiting
      if ((packetData.startsWith('S') || packetData.startsWith('T')) && this.packetResolvers.length === 0) {
        this.pendingStopReply = packetData;
        this._isRunning = false;
        this.debug(`[GDB] Async stop reply: ${packetData}`);
        continue;
      }

      // Deliver to waiting resolver
      const resolver = this.packetResolvers.shift();
      if (resolver) {
        clearTimeout(resolver.timer);
        // Track stop for run commands
        if (packetData.startsWith('S') || packetData.startsWith('T')) {
          this._isRunning = false;
        }
        resolver.resolve(packetData);
      } else {
        this.debug(`[GDB] Unsolicited packet: ${packetData.slice(0, 50)}`);
      }
    }
  }

  /**
   * Compute GDB RSP checksum (sum of bytes mod 256)
   */
  private computeChecksum(data: string): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data.charCodeAt(i);
    }
    return sum & 0xFF;
  }

  /**
   * Send a raw packet with framing: $data#XX
   */
  private sendPacket(data: string): void {
    const checksum = this.computeChecksum(data);
    const packet = `$${data}#${checksum.toString(16).padStart(2, '0')}`;
    this.debug(`[GDB] [SEND] ${data.slice(0, 100)}${data.length > 100 ? '...' : ''}`);
    this.socketWrite(packet);
  }

  /**
   * Send a command and wait for response
   */
  private sendCommand(command: string, timeoutMs: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.packetResolvers.findIndex(r => r.resolve === resolve);
        if (idx >= 0) {
          this.packetResolvers.splice(idx, 1);
        }
        reject(new Error(`GDB command timeout: ${command}`));
      }, timeoutMs);

      this.packetResolvers.push({ resolve, reject, timer });
      this.sendPacket(command);
    });
  }

  /**
   * Send a command and wait for stop reply (for continue/step)
   * These commands get a stop reply (S/T packet) when execution stops
   */
  private sendRunCommand(command: string, timeoutMs: number = 30000): Promise<string> {
    return this.sendCommand(command, timeoutMs);
  }

  private socketWrite(data: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data, 'binary');
    }
  }

  private debug(msg: string): void {
    if (this.debugMode) {
      console.error(msg);
    }
  }

  private rejectAll(error: Error): void {
    for (const resolver of this.packetResolvers) {
      clearTimeout(resolver.timer);
      resolver.reject(error);
    }
    this.packetResolvers = [];
  }

  // ─── Register Commands ──────────────────────────────────────────────

  /**
   * Read all registers: sends 'g', parses 18 × 8 hex chars (big-endian 32-bit)
   */
  async readRegisters(): Promise<M68kRegisters> {
    const reply = await this.sendCommand('g');
    if (reply.length < 144) {
      throw new Error(`Register reply too short: ${reply.length} chars (expected 144)`);
    }

    const regs: Partial<M68kRegisters> = {};
    for (let i = 0; i < 18; i++) {
      const hex = reply.slice(i * 8, i * 8 + 8);
      const value = parseInt(hex, 16); // big-endian
      (regs as any)[REGISTER_NAMES[i]] = value;
    }
    return regs as M68kRegisters;
  }

  /**
   * Read a single register by index
   */
  async readRegister(id: number): Promise<number> {
    const reply = await this.sendCommand(`p${id.toString(16)}`);
    return parseInt(reply, 16);
  }

  /**
   * Write a single register by index: sends 'P<id>=<hex>'
   */
  async writeRegister(id: number, value: number): Promise<void> {
    const hex = (value >>> 0).toString(16).padStart(8, '0');
    const reply = await this.sendCommand(`P${id.toString(16)}=${hex}`);
    if (reply !== 'OK') throw new Error(`Register write failed for reg ${id}: ${reply}`);
  }

  /**
   * Write all registers: sends 'G<hex>' (18 regs × 8 hex chars)
   */
  async writeRegisters(regs: M68kRegisters): Promise<void> {
    let hex = '';
    for (const name of REGISTER_NAMES) {
      hex += ((regs[name] as number) >>> 0).toString(16).padStart(8, '0');
    }
    const reply = await this.sendCommand(`G${hex}`);
    if (reply !== 'OK') throw new Error(`Register write-all failed: ${reply}`);
  }

  // ─── Memory Commands ────────────────────────────────────────────────

  /**
   * Read memory: sends 'm<addr>,<len>', returns Buffer
   */
  async readMemory(addr: number, length: number): Promise<Buffer> {
    const reply = await this.sendCommand(`m${addr.toString(16)},${length.toString(16)}`);
    if (reply.startsWith('E')) {
      throw new Error(`Memory read error at $${addr.toString(16)}: ${reply}`);
    }
    return Buffer.from(reply, 'hex');
  }

  /**
   * Write memory: sends 'M<addr>,<len>:<hex>'
   */
  async writeMemory(addr: number, data: Buffer): Promise<void> {
    const hex = data.toString('hex');
    const reply = await this.sendCommand(`M${addr.toString(16)},${data.length.toString(16)}:${hex}`);
    if (reply !== 'OK') {
      throw new Error(`Memory write error at $${addr.toString(16)}: ${reply}`);
    }
  }

  // ─── Breakpoint Commands ────────────────────────────────────────────

  /**
   * Set software breakpoint: Z0,<addr>,2
   */
  async setBreakpoint(addr: number): Promise<void> {
    const reply = await this.sendCommand(`Z0,${addr.toString(16)},2`);
    if (reply !== 'OK') {
      throw new Error(`Set breakpoint failed at $${addr.toString(16)}: ${reply}`);
    }
  }

  /**
   * Clear software breakpoint: z0,<addr>,2
   */
  async clearBreakpoint(addr: number): Promise<void> {
    const reply = await this.sendCommand(`z0,${addr.toString(16)},2`);
    if (reply !== 'OK') {
      throw new Error(`Clear breakpoint failed at $${addr.toString(16)}: ${reply}`);
    }
  }

  // ─── Watchpoint Commands ────────────────────────────────────────────

  /**
   * Set watchpoint: Z<type>,<addr>,<len>
   */
  async setWatchpoint(addr: number, length: number, type: WatchpointType): Promise<void> {
    const typeNum = WATCHPOINT_TYPE_MAP[type];
    const reply = await this.sendCommand(`Z${typeNum},${addr.toString(16)},${length.toString(16)}`);
    if (reply !== 'OK') {
      throw new Error(`Set watchpoint failed at $${addr.toString(16)}: ${reply}`);
    }
  }

  /**
   * Clear watchpoint: z<type>,<addr>,<len>
   */
  async clearWatchpoint(addr: number, length: number, type: WatchpointType): Promise<void> {
    const typeNum = WATCHPOINT_TYPE_MAP[type];
    const reply = await this.sendCommand(`z${typeNum},${addr.toString(16)},${length.toString(16)}`);
    if (reply !== 'OK') {
      throw new Error(`Clear watchpoint failed at $${addr.toString(16)}: ${reply}`);
    }
  }

  // ─── Execution Control ──────────────────────────────────────────────

  /**
   * Continue execution: sends 'vCont;c', returns immediately (fire-and-forget).
   * The stop reply will arrive asynchronously when a breakpoint/watchpoint fires.
   * Use pause() to stop execution, or check isRunning to see if already stopped.
   * Note: BartmanAbyss WinUAE only supports vCont commands, not basic 'c'.
   */
  async continue(): Promise<void> {
    this.pendingStopReply = null;
    this._isRunning = true;
    this.sendPacket('vCont;c');
  }

  /**
   * Single step: sends 'vCont;s', waits for stop reply (step always stops quickly)
   * Note: BartmanAbyss WinUAE only supports vCont commands, not basic 's'.
   */
  async step(): Promise<string> {
    this._isRunning = true;
    const reply = await this.sendRunCommand('vCont;s');
    this._isRunning = false;
    return reply;
  }

  /**
   * Pause/interrupt execution. If CPU already stopped (async breakpoint hit),
   * returns the pending stop reply immediately. Otherwise sends 0x03 interrupt.
   */
  async pause(): Promise<string> {
    // If a stop reply arrived asynchronously (breakpoint fired), return it
    if (this.pendingStopReply) {
      const reply = this.pendingStopReply;
      this.pendingStopReply = null;
      return reply;
    }

    // If not running, just return
    if (!this._isRunning) {
      return 'S00';
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.packetResolvers.findIndex(r => r.resolve === resolve);
        if (idx >= 0) {
          this.packetResolvers.splice(idx, 1);
        }
        reject(new Error('Pause timeout'));
      }, 10000);

      this.packetResolvers.push({ resolve, reject, timer });

      // Send raw interrupt byte (not a GDB packet)
      if (this.socket && !this.socket.destroyed) {
        this.socket.write(Buffer.from([0x03]));
      }
    });
  }

  /**
   * Whether the CPU is currently running (continue was sent, no stop reply yet)
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Disconnect from GDB server
   */
  disconnect(): void {
    this.rejectAll(new Error('Disconnected'));
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}
