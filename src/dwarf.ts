/**
 * Lector DWARF minimo (v4/v5, 32-bit) para resolver direcciones de campos de
 * variables globales desde un .elf del toolchain m68k-amiga-elf.
 *
 * Soporta lo necesario para `winuae_print` con campos simples:
 * - Encontrar un DW_TAG_variable por nombre (DW_AT_name / DW_AT_linkage_name).
 * - Obtener el tipo de una variable (DW_AT_type, resolviendo typedef/const/volatile).
 * - Miembros de structure/class/union: nombre + offset + tipo.
 * - Arrays (DW_TAG_array_type + subrange) -> elemento/tamano.
 * - Punteros (DW_TAG_pointer_type) -> tamano 4.
 *
 * No cubre location expressions complejas ni DWARF64.
 */
import fs from 'fs';

const DW_TAG_array_type = 0x01;
const DW_TAG_class_type = 0x02;
const DW_TAG_member = 0x0d;
const DW_TAG_pointer_type = 0x0f;
const DW_TAG_reference_type = 0x10;
const DW_TAG_structure_type = 0x13;
const DW_TAG_typedef = 0x16;
const DW_TAG_subrange_type = 0x21;
const DW_TAG_base_type = 0x24;
const DW_TAG_const_type = 0x26;
const DW_TAG_variable = 0x34;
const DW_TAG_volatile_type = 0x35;
const DW_TAG_union_type = 0x17;
const DW_TAG_enumeration_type = 0x04;

const DW_AT_name = 0x03;
const DW_AT_data_member_location = 0x38;
const DW_AT_byte_size = 0x0b;
const DW_AT_type = 0x49;
const DW_AT_linkage_name = 0x6e;
const DW_AT_upper_bound = 0x2f;
const DW_AT_count = 0x37;
const DW_AT_location = 0x02;

function uleb(buf: Buffer, off: number): [number, number] {
  let result = 0, shift = 0;
  for (;;) {
    const b = buf[off++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result, off];
}
function sleb(buf: Buffer, off: number): [number, number] {
  let result = 0, shift = 0, b = 0;
  do {
    b = buf[off++];
    result |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  if (shift < 32 && (b & 0x40)) result |= -1 << shift;
  return [result, off];
}

interface Section { name: string; offset: number; size: number; buf: Buffer; }

function parseElfSections(elf: Buffer): Section[] {
  const shoff = elf.readUInt32BE(0x20);
  const shentsize = elf.readUInt16BE(0x2e);
  const shnum = elf.readUInt16BE(0x30);
  const shstrndx = elf.readUInt16BE(0x32);
  const shstrOff = shoff + shstrndx * shentsize;
  const shstr = elf.subarray(elf.readUInt32BE(shstrOff + 0x10), elf.readUInt32BE(shstrOff + 0x10) + elf.readUInt32BE(shstrOff + 0x14));
  const sections: Section[] = [];
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize;
    const nameOff = elf.readUInt32BE(base);
    const type = elf.readUInt32BE(base + 4);
    if (type === 0) continue;
    const off = elf.readUInt32BE(base + 0x10);
    const size = elf.readUInt32BE(base + 0x14);
    let name = '';
    for (let p = nameOff; p < shstr.length && shstr[p] !== 0; p++) name += String.fromCharCode(shstr[p]);
    sections.push({ name, offset: off, size, buf: elf.subarray(off, off + size) });
  }
  return sections;
}

interface Die {
  off: number;
  tag: number;
  attrs: Map<number, { form: number; value: any }>;
  children: Die[];
}

export interface MemberInfo { name: string; offset: number; typeDie: Die | null; }
export interface ResolvedType {
  die: Die | null;
  size: number;
  kind: string;
  members: MemberInfo[];
  elementSize?: number;
  arrayCount?: number;
}

export class DwarfReader {
  private dies: Map<number, Die> = new Map();
  private typeCache = new Map<number, ResolvedType>();
  private elfSections: Section[] = [];

  constructor(private elfPath: string) {}

  parse(): void {
    const elf = fs.readFileSync(this.elfPath);
    this.elfSections = parseElfSections(elf);
    const info = this.elfSections.find(s => s.name === '.debug_info');
    const abbrev = this.elfSections.find(s => s.name === '.debug_abbrev');
    if (!info || !abbrev) throw new Error('no DWARF sections in elf');
    const str = this.elfSections.find(s => s.name === '.debug_str');

    const infoBuf = info.buf;
    let p = 0;
    while (p + 11 < infoBuf.length) {
      const unitLength = infoBuf.readUInt32BE(p);
      if (unitLength === 0xffffffff) throw new Error('DWARF64 no soportado');
      const version = infoBuf.readUInt16BE(p + 4);
      const cuHeaderStart = p;
      let cuStart: number, abbrevOffset: number, cuEnd: number;
      if (version >= 5) {
        // unit_length(4) version(2) unit_type(1) address_size(1) abbrev_offset(4)
        cuStart = p + 12;
        abbrevOffset = infoBuf.readUInt32BE(p + 8);
      } else {
        // unit_length(4) version(2) abbrev_offset(4) address_size(1)
        cuStart = p + 11;
        abbrevOffset = infoBuf.readUInt32BE(p + 6);
      }
      cuEnd = p + 4 + unitLength;
      // las refs (DW_FORM_ref*) son relativas al inicio del header de la CU
      this.parseDies(infoBuf, abbrev.buf, str?.buf, cuStart, cuEnd, cuHeaderStart, abbrevOffset);
      p = cuEnd;
    }
  }

  private readString(str: Buffer | undefined, off: number): string {
    if (!str) return '';
    let s = '';
    for (let p = off; p < str.length && str[p] !== 0; p++) s += String.fromCharCode(str[p]);
    return s;
  }

  private parseDies(info: Buffer, abbrev: Buffer, str: Buffer | undefined, start: number, end: number, cuBase: number, abbrevOffset: number): { dies: Die[]; next: number } {
    const dies: Die[] = [];
    let p = start;
    while (p < end) {
      const dieStart = p; // offset del DIE = inicio del ULEB del codigo
      const codeRes = uleb(info, p);
      const code = codeRes[0];
      p = codeRes[1];
      if (code === 0) return { dies, next: p }; // 0x00: fin de hijos; el llamador continua tras el
      // localizar la abbrev (tabla empieza en abbrevOffset)
      let ap = abbrevOffset;
      let found: { tag: number; hasChildren: number; spec: { attr: number; form: number }[] } | null = null;
      for (;;) {
        const aRes = uleb(abbrev, ap);
        const acode = aRes[0];
        ap = aRes[1];
        if (acode === 0) break;
        const tagRes = uleb(abbrev, ap);
        const tag = tagRes[0];
        ap = tagRes[1];
        const hasChildren = abbrev[ap++];
        const spec: { attr: number; form: number }[] = [];
        for (;;) {
          const aRes2 = uleb(abbrev, ap);
          const attr = aRes2[0];
          ap = aRes2[1];
          const fRes = uleb(abbrev, ap);
          const form = fRes[0];
          ap = fRes[1];
          if (attr === 0 && form === 0) break;
          if (form === 0x21) { // DW_FORM_implicit_const: valor SLEB en la tabla de abbrev
            ap = sleb(abbrev, ap)[1];
          }
          spec.push({ attr, form });
        }
        if (acode === code) { found = { tag, hasChildren, spec }; break; }
      }
      if (!found) break;
      const die: Die = { off: dieStart, tag: found.tag, attrs: new Map(), children: [] };
      for (const s of found.spec) {
        const r = this.readAttr(info, str, p, s.form, cuBase);
        p = r[0];
        die.attrs.set(s.attr, { form: s.form, value: r[1] });
      }
      this.dies.set(die.off, die);
      if (found.hasChildren) {
        const sub = this.parseDies(info, abbrev, str, p, end, cuBase, abbrevOffset);
        die.children = sub.dies;
        p = sub.next;
      }
      dies.push(die);
    }
    return { dies, next: p };
  }

  private readAttr(info: Buffer, str: Buffer | undefined, p: number, form: number, cuBase: number): [number, any] {
    switch (form) {
      case 0x01: return [p + 4, info.readUInt32BE(p)];
      case 0x03: { const len = info.readUInt16BE(p); return [p + 2 + len, info.subarray(p + 2, p + 2 + len)]; }
      case 0x04: { const len = info.readUInt32BE(p); return [p + 4 + len, info.subarray(p + 4, p + 4 + len)]; }
      case 0x05: return [p + 2, info.readUInt16BE(p)];
      case 0x06: return [p + 4, info.readUInt32BE(p)];
      case 0x07: return [p + 8, Number(info.readBigUInt64BE(p))];
      case 0x08: { let s = ''; for (let q = p; q < info.length && info[q] !== 0; q++) s += String.fromCharCode(info[q]); return [p + s.length + 1, s]; }
      case 0x09: { const r = uleb(info, p); return [p + r[0], info.subarray(p, p + r[0])]; }
      case 0x0a: { const len = info[p]; return [p + 1 + len, info.subarray(p + 1, p + 1 + len)]; }
      case 0x0b: return [p + 1, info[p]];
      case 0x0c: return [p + 1, info[p]];
      case 0x0d: { const r = sleb(info, p); return [r[1], r[0]]; }
      case 0x0e: return [p + 4, str ? this.readString(str, info.readUInt32BE(p)) : ''];
      case 0x0f: { const r = uleb(info, p); return [r[1], r[0]]; }
      case 0x10: return [p + 4, cuBase + info.readUInt32BE(p)];
      case 0x11: return [p + 1, cuBase + info[p]];
      case 0x12: return [p + 2, cuBase + info.readUInt16BE(p)];
      case 0x13: return [p + 4, cuBase + info.readUInt32BE(p)];
      case 0x14: return [p + 8, cuBase + Number(info.readBigUInt64BE(p))];
      case 0x15: { const r = uleb(info, p); return [r[1], cuBase + r[0]]; }
      case 0x16: { const r = uleb(info, p); return this.readAttr(info, str, p, r[0], cuBase); }
      case 0x17: return [p + 4, info.readUInt32BE(p)];
      case 0x18: { const r = uleb(info, p); return [p + r[0], info.subarray(p, p + r[0])]; }
      case 0x19: return [p, 1];
      case 0x1a: { const r = uleb(info, p); return [r[1], r[0]]; } // strx
      case 0x1b: { const r = uleb(info, p); return [r[1], r[0]]; } // addrx
      case 0x21: return [p, 0]; // implicit_const
      default: return [p, 0];
    }
  }

  dieName(die: Die): string {
    const a = die.attrs.get(DW_AT_name);
    return a ? String(a.value) : '';
  }

  /** Direccion linked de una variable desde DW_AT_location (DW_OP_addr). */
  variableAddress(die: Die): number | null {
    const loc = die.attrs.get(DW_AT_location);
    if (!loc) return null;
    const buf = loc.value;
    if (!Buffer.isBuffer(buf)) return null;
    if (buf.length >= 5 && buf[0] === 0x03) return buf.readUInt32BE(1); // DW_OP_addr (big-endian target)
    return null;
  }

  get dieCount(): number { return this.dies.size; }
  debugInfo(): string {
    const info = this.elfSections.find(s => s.name === '.debug_info');
    return `info=${info?.size ?? 0} dies=${this.dies.size}`;
  }

  findVariable(name: string): Die | null {
    for (const die of this.dies.values()) {
      if (die.tag !== DW_TAG_variable) continue;
      if (this.dieName(die) === name) return die;
      const ln = die.attrs.get(DW_AT_linkage_name);
      if (ln && String(ln.value) === name) return die;
    }
    return null;
  }

  /** Busca un tipo (struct/class/union) por nombre (p. ej. 'RunStatus'). */
  findType(name: string): Die | null {
    for (const die of this.dies.values()) {
      if (die.tag === DW_TAG_structure_type || die.tag === DW_TAG_class_type || die.tag === DW_TAG_union_type) {
        const n = this.dieName(die);
        if (n === name || n.endsWith('::' + name)) return die;
      }
    }
    return null;
  }

  resolveRef(value: any): Die | null {
    return this.dies.get(Number(value)) || null;
  }

  private derefType(die: Die): Die | null {
    let d: Die | null = die;
    for (let i = 0; i < 16; i++) {
      if (!d) return null;
      if (d.tag === DW_TAG_typedef || d.tag === DW_TAG_const_type || d.tag === DW_TAG_volatile_type) {
        const t = d.attrs.get(DW_AT_type);
        if (!t) return d;
        d = this.resolveRef(t.value);
        continue;
      }
      return d;
    }
    return d;
  }

  resolveType(die: Die | null): ResolvedType {
    if (!die) return { die: null, size: 4, kind: 'unknown', members: [] };
    const real = this.derefType(die);
    if (!real) return { die, size: 4, kind: 'unknown', members: [] };
    if (this.typeCache.has(real.off)) return this.typeCache.get(real.off)!;
    const base: ResolvedType = { die: real, size: 4, kind: 'unknown', members: [] };
    this.typeCache.set(real.off, base);
    const sizeAttr = real.attrs.get(DW_AT_byte_size);
    base.size = sizeAttr ? Number(sizeAttr.value) : 4;
    if (real.tag === DW_TAG_pointer_type || real.tag === DW_TAG_reference_type) {
      base.kind = 'pointer';
      base.size = 4;
      const t = real.attrs.get(DW_AT_type);
      base.die = t ? this.resolveRef(t.value) : null;
    } else if (real.tag === DW_TAG_structure_type || real.tag === DW_TAG_class_type || real.tag === DW_TAG_union_type) {
      base.kind = 'struct';
      base.members = [];
      for (const c of real.children) {
        if (c.tag !== DW_TAG_member) continue;
        const name = this.dieName(c);
        let off = 0;
        const offAttr = c.attrs.get(DW_AT_data_member_location);
        if (offAttr && typeof offAttr.value === 'number') off = offAttr.value;
        else if (offAttr && Buffer.isBuffer(offAttr.value)) {
          const buf = offAttr.value;
          if (buf.length >= 2 && buf[0] === 0x23) { const r = uleb(buf, 1); off = r[0]; }
          else if (buf.length === 1 && buf[0] === 0x00) off = 0;
        }
        const tAttr = c.attrs.get(DW_AT_type);
        base.members.push({ name, offset: off, typeDie: tAttr ? this.resolveRef(tAttr.value) : null });
      }
    } else if (real.tag === DW_TAG_array_type) {
      base.kind = 'array';
      let elemType: Die | null = null;
      let count = 0;
      for (const c of real.children) {
        if (c.tag === DW_TAG_subrange_type) {
          const ub = c.attrs.get(DW_AT_upper_bound);
          const cnt = c.attrs.get(DW_AT_count);
          if (ub && typeof ub.value === 'number') count = Number(ub.value) + 1;
          else if (cnt && typeof cnt.value === 'number') count = Number(cnt.value);
          const t = c.attrs.get(DW_AT_type);
          if (t) elemType = this.resolveRef(t.value);
        }
      }
      base.arrayCount = count;
      if (elemType) {
        const et = this.derefType(elemType);
        const es = et?.attrs.get(DW_AT_byte_size);
        base.elementSize = es ? Number(es.value) : 2;
      } else {
        base.elementSize = count ? Math.max(1, Math.floor(base.size / count)) : 2;
      }
      const t = real.attrs.get(DW_AT_type);
      if (t) base.die = this.resolveRef(t.value);
    } else if (real.tag === DW_TAG_base_type) {
      base.kind = 'base';
    } else if (real.tag === DW_TAG_enumeration_type) {
      base.kind = 'enum';
      base.size = 4;
    }
    return base;
  }
}

