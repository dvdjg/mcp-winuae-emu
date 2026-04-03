export interface M68kRegisterLike {
  D0: number; D1: number; D2: number; D3: number;
  D4: number; D5: number; D6: number; D7: number;
  A0: number; A1: number; A2: number; A3: number;
  A4: number; A5: number; A6: number; A7: number;
  SR: number; PC: number;
}

export type RegisterName = keyof M68kRegisterLike;

export interface RegisterEqualsCondition {
  register: RegisterName;
  value: number;
}

export interface RegisterMaskEqualsCondition {
  register: RegisterName;
  mask: number;
  value: number;
}

export interface MemoryEqualsCondition {
  address: number;
  value: Buffer;
}

export interface CustomEqualsCondition {
  offset: number;
  name: string;
  value: number;
}

export interface ConditionalBreakpointRequest {
  address: number;
  timeoutMs: number;
  maxHits: number;
  autoClear: boolean;
  registerEquals: RegisterEqualsCondition[];
  registerMaskEquals: RegisterMaskEqualsCondition[];
  memoryEquals: MemoryEqualsCondition[];
  customEquals: CustomEqualsCondition[];
}

export interface ConditionClauseResult {
  kind: 'register_equals' | 'register_mask_equals' | 'memory_equals' | 'custom_equals';
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface ConditionalBreakpointEvaluation {
  matched: boolean;
  clauses: ConditionClauseResult[];
}

const REGISTER_NAMES: RegisterName[] = [
  'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'SR', 'PC',
];

function parseHexOrDecimal(value: string | number): number {
  if (typeof value === 'number') {
    return value >>> 0;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('$')) {
    return parseInt(trimmed.slice(1), 16) >>> 0;
  }
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return parseInt(trimmed.slice(2), 16) >>> 0;
  }
  return parseInt(trimmed, 10) >>> 0;
}

function normalizeRegisterName(value: unknown): RegisterName {
  const name = String(value).trim().toUpperCase() as RegisterName;
  if (!REGISTER_NAMES.includes(name)) {
    throw new Error(`Unsupported register name: ${value}`);
  }
  return name;
}

function hex32(value: number): string {
  return '$' + (value >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function hex16(value: number): string {
  return '$' + (value & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
}

function normalizeHexBytes(value: unknown): Buffer {
  const cleaned = String(value).replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    throw new Error(`Invalid hex byte string: ${value}`);
  }
  return Buffer.from(cleaned, 'hex');
}

function resolveCustomOffset(
  item: Record<string, unknown>,
  customRegs: Record<number, string>
): { offset: number; name: string } {
  if (item.offset !== undefined) {
    const offset = parseHexOrDecimal(item.offset as string | number);
    const name = customRegs[offset] || `REG_${offset.toString(16).toUpperCase()}`;
    return { offset, name };
  }

  const wantedName = String(item.name ?? '').trim().toUpperCase();
  if (!wantedName) {
    throw new Error('custom_equals entries need either "offset" or "name"');
  }

  for (const [offset, name] of Object.entries(customRegs)) {
    if (name.toUpperCase() === wantedName) {
      return { offset: Number(offset), name };
    }
  }

  throw new Error(`Unknown custom register name: ${wantedName}`);
}

export function normalizeConditionalBreakpointRequest(
  args: Record<string, unknown>,
  customRegs: Record<number, string>
): ConditionalBreakpointRequest {
  const registerEquals = Object.entries((args.register_equals ?? {}) as Record<string, string | number>)
    .map(([register, value]) => ({
      register: normalizeRegisterName(register),
      value: parseHexOrDecimal(value),
    }));

  const registerMaskEquals = ((args.register_mask_equals ?? []) as Array<Record<string, unknown>>)
    .map((item) => ({
      register: normalizeRegisterName(item.register),
      mask: parseHexOrDecimal(item.mask as string | number),
      value: parseHexOrDecimal(item.value as string | number),
    }));

  const memoryEquals = ((args.memory_equals ?? []) as Array<Record<string, unknown>>)
    .map((item) => ({
      address: parseHexOrDecimal(item.address as string | number),
      value: normalizeHexBytes(item.value_hex),
    }));

  const customEquals = ((args.custom_equals ?? []) as Array<Record<string, unknown>>)
    .map((item) => {
      const resolved = resolveCustomOffset(item, customRegs);
      return {
        ...resolved,
        value: parseHexOrDecimal(item.value as string | number) & 0xFFFF,
      };
    });

  if (
    registerEquals.length === 0 &&
    registerMaskEquals.length === 0 &&
    memoryEquals.length === 0 &&
    customEquals.length === 0
  ) {
    throw new Error('At least one conditional clause is required');
  }

  return {
    address: parseHexOrDecimal(args.address as string | number),
    timeoutMs: Math.max(1, Number(args.timeout_ms ?? 30000)),
    maxHits: Math.max(1, Math.min(256, Number(args.max_hits ?? 32))),
    autoClear: args.auto_clear !== false,
    registerEquals,
    registerMaskEquals,
    memoryEquals,
    customEquals,
  };
}

export function evaluateConditionalBreakpoint(
  request: ConditionalBreakpointRequest,
  context: {
    registers: M68kRegisterLike;
    customData?: Buffer;
    memoryByAddress?: Map<number, Buffer>;
  }
): ConditionalBreakpointEvaluation {
  const clauses: ConditionClauseResult[] = [];

  for (const condition of request.registerEquals) {
    const actual = context.registers[condition.register] >>> 0;
    clauses.push({
      kind: 'register_equals',
      label: condition.register,
      expected: hex32(condition.value),
      actual: hex32(actual),
      passed: actual === (condition.value >>> 0),
    });
  }

  for (const condition of request.registerMaskEquals) {
    const actual = context.registers[condition.register] >>> 0;
    const masked = actual & (condition.mask >>> 0);
    clauses.push({
      kind: 'register_mask_equals',
      label: `${condition.register} & ${hex32(condition.mask)}`,
      expected: hex32(condition.value),
      actual: hex32(masked),
      passed: masked === (condition.value >>> 0),
    });
  }

  for (const condition of request.memoryEquals) {
    const actual = context.memoryByAddress?.get(condition.address) ?? Buffer.alloc(0);
    clauses.push({
      kind: 'memory_equals',
      label: hex32(condition.address),
      expected: condition.value.toString('hex').toUpperCase(),
      actual: actual.toString('hex').toUpperCase(),
      passed: actual.equals(condition.value),
    });
  }

  for (const condition of request.customEquals) {
    const actual = context.customData ? context.customData.readUInt16BE(condition.offset) : -1;
    clauses.push({
      kind: 'custom_equals',
      label: condition.name,
      expected: hex16(condition.value),
      actual: actual >= 0 ? hex16(actual) : '<unavailable>',
      passed: actual === condition.value,
    });
  }

  return {
    matched: clauses.every((clause) => clause.passed),
    clauses,
  };
}

export function buildConditionalBreakpointResponse(args: {
  request: ConditionalBreakpointRequest;
  hits: number;
  matched: boolean;
  stopReply?: string;
  timedOut?: boolean;
  breakpointCleared?: boolean;
  registers?: M68kRegisterLike;
  evaluation?: ConditionalBreakpointEvaluation;
}): Record<string, unknown> {
  return {
    tool: 'winuae_breakpoint_conditional_wait',
    implementation: 'software-assisted',
    native_stub_conditionals_supported: false,
    matched: args.matched,
    timed_out: args.timedOut ?? false,
    hits_observed: args.hits,
    breakpoint: {
      address: hex32(args.request.address),
      auto_cleared: args.breakpointCleared ?? false,
    },
    stop_reply: args.stopReply ?? null,
    registers: args.registers ? Object.fromEntries(
      REGISTER_NAMES.map((name) => [name, hex32(args.registers![name])])
    ) : undefined,
    conditions: args.evaluation ? args.evaluation.clauses : undefined,
  };
}
