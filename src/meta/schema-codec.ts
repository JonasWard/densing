// schema-codec.ts - a whole schema as a compact string, and back (FORMAT.md section 4)
import { BitReader, BitWriter } from '../codec/bits';
import { BaseSpec } from '../encoding/alphabets';
import { DenseDecodeError } from '../errors';
import { bitsForEnumArrayContent, bitsForRange, densingField, undensingField } from '../densing';
import {
  DenseField,
  DenseSchema,
  EnumField,
  FieldTypes,
  FixedPointField,
  NumericDefinition,
  OptionalField,
  assertNeverDenseField
} from '../schema-type';
import { MAX_FIELD_BITS, fixedFromUInt, fixedMaxStep, uIntForFixed } from '../values';
import { assertValidSchema } from '../schema/validate-schema';
import { schemaFromJson } from '../schema/from-json';

const VERSION = 0;
const VERSION_BITS = 3;
const TYPE_BITS = bitsForRange(FieldTypes.length);
const MAX_CODE_POINT = 0x10ffff;
/** Nesting deeper than this is rejected when decoding, so malformed input cannot exhaust the stack */
const MAX_DEPTH = 256;
/** Longest string accepted when the alphabet has a single character (its characters cost no bits) */
const MAX_FREE_STRING = 1 << 16;

/** State of an optional field's default value, stored in 2 bits */
const enum OptionalDefault {
  Undefined = 0,
  Null = 1,
  /** densed with the inner field, after the structure */
  Dense = 2,
  /** as JSON text, after the structure, for values the inner field cannot encode losslessly */
  Json = 3
}

/* =========================
 * Output: the same walk collects the strings (first pass) and writes the bits (second pass)
 * ========================= */

interface Out {
  uint(value: number | bigint, bits: number): void;
  /** unsigned, Elias delta of n + 1 */
  U(n: number): void;
  /** sign bit, then U of the magnitude */
  I(n: number): void;
  /** raw float64, the fallback for numbers that are not exact on their grid */
  F(x: number): void;
  /** the flag in front of a number: exact on its grid, or a float64 follows */
  exact(isExact: boolean): void;
  S(s: string): void;
  /** an optional field's default, densed with its inner field */
  dense(field: DenseField, value: unknown): void;
}

const assertSafeUnsigned = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`densingSchema: cannot store ${n} as an unsigned integer`);
};

class CollectOut implements Out {
  readonly strings: string[] = [];
  numbers = 0;
  floatFallbacks = 0;
  uint(): void {}
  exact(isExact: boolean): void {
    this.numbers++;
    if (!isExact) this.floatFallbacks++;
  }
  U(n: number): void {
    assertSafeUnsigned(n);
  }
  I(n: number): void {
    assertSafeUnsigned(Math.abs(n));
  }
  F(): void {}
  S(s: string): void {
    this.strings.push(s);
  }
  dense(): void {}
}

class WriteOut implements Out {
  private next = 0;
  constructor(
    private readonly w: BitWriter,
    private readonly plan: StringPlan,
    private readonly alphabet: Alphabet,
    private readonly schema: DenseSchema
  ) {}
  uint(value: number | bigint, bits: number): void {
    this.w.writeUInt(value, bits);
  }
  exact(isExact: boolean): void {
    this.w.writeUInt(isExact ? 0 : 1, 1);
  }
  U(n: number): void {
    writeU(this.w, n);
  }
  I(n: number): void {
    this.w.writeUInt(n < 0 || Object.is(n, -0) ? 1 : 0, 1);
    writeU(this.w, Math.abs(n));
  }
  F(x: number): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    this.w.writeUInt(view.getBigUint64(0), 64);
  }
  S(): void {
    writeStringOp(this.w, this.plan, this.plan.ops[this.next++], this.alphabet.codePoints.length);
  }
  dense(field: DenseField, value: unknown): void {
    densingField(this.w, field, value, this.schema, 'default');
  }
}

const writeU = (w: BitWriter, n: number) => {
  assertSafeUnsigned(n);
  const v = BigInt(n) + 1n;
  const length = v.toString(2).length;
  const lengthBits = length.toString(2).length;
  w.writeUInt(0, lengthBits - 1);
  w.writeUInt(length, lengthBits);
  w.writeUInt(v - (1n << BigInt(length - 1)), length - 1);
};

/* =========================
 * Strings: a schema-local alphabet of code points, written once; each string in it as one
 * base-n number; repeats as back-references; optionally a prefix or suffix copied from an earlier string
 * ========================= */

interface Alphabet {
  codePoints: number[];
  index: Map<number, number>;
}

/** How one string slot is written; `seen` is the number of distinct strings before it */
type StringOp =
  | { kind: 'repeat'; seen: number; index: number }
  | { kind: 'plain'; seen: number; chars: number[] }
  | { kind: 'affix'; seen: number; index: number; suffix: boolean; shared: number; chars: number[] };

interface StringPlan {
  backRefs: boolean;
  affixes: boolean;
  ops: StringOp[];
  bits: number;
}

const MIN_AFFIX = 3;

const uBits = (n: number): number => {
  const length = (n + 1).toString(2).length;
  return 2 * length.toString(2).length - 1 + length - 1;
};

const codePoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0)!);

const buildAlphabet = (strings: string[]): Alphabet => {
  const codePointSet = new Set<number>();
  for (const s of strings) for (const cp of codePoints(s)) codePointSet.add(cp);
  const sorted = [...codePointSet].sort((a, b) => a - b);
  return { codePoints: sorted, index: new Map(sorted.map((cp, i) => [cp, i])) };
};

const affixKey = (cps: number[], suffix: boolean): string =>
  String.fromCodePoint(...(suffix ? cps.slice(-MIN_AFFIX) : cps.slice(0, MIN_AFFIX)));

/** Per string slot, what the plans need: everything here is the same whichever features are on */
interface StringSlot {
  /** distinct strings before this slot */
  seen: number;
  /** index of the same string seen earlier */
  repeat?: number;
  chars: number[];
  /** the longest prefix or suffix shared with an earlier string (≥ MIN_AFFIX code points) */
  affix?: { index: number; suffix: boolean; shared: number };
}

const analyzeStrings = (strings: string[], alphabet: Alphabet): StringSlot[] => {
  const seenIndex = new Map<string, number>();
  const seen: number[][] = [];
  const byAffix = new Map<string, number[]>(); // "p" / "s" + first / last code points -> earlier strings
  return strings.map((s) => {
    const before = seen.length;
    const repeat = seenIndex.get(s);
    const cps = codePoints(s);
    const slot: StringSlot = { seen: before, repeat, chars: cps.map((cp) => alphabet.index.get(cp)!) };
    // also for a repeat: without back-references it can still be copied whole from its first use
    if (cps.length >= MIN_AFFIX)
      for (const suffix of [false, true])
        for (const index of byAffix.get((suffix ? 's' : 'p') + affixKey(cps, suffix)) ?? []) {
          const other = seen[index];
          const cpAt = (list: number[], i: number) => (suffix ? list[list.length - 1 - i] : list[i]);
          let shared = MIN_AFFIX;
          while (shared < cps.length && shared < other.length && cpAt(cps, shared) === cpAt(other, shared)) shared++;
          // sharing more is always cheaper; ties keep the earlier string, prefixes before suffixes
          if (!slot.affix || shared > slot.affix.shared) slot.affix = { index, suffix, shared };
        }
    if (repeat !== undefined) return slot;
    seenIndex.set(s, before);
    seen.push(cps);
    if (cps.length >= MIN_AFFIX)
      for (const suffix of [false, true]) {
        const key = (suffix ? 's' : 'p') + affixKey(cps, suffix);
        const list = byAffix.get(key);
        if (list) list.push(before);
        else byAffix.set(key, [before]);
      }
    return slot;
  });
};

/**
 * How every string slot is written with the given features, and what it costs. The writer executes
 * the plan and the reader mirrors it; an affix is only used when it is cheaper than the plain form.
 */
const planStrings = (slots: StringSlot[], alphabetSize: number, backRefs: boolean, affixes: boolean): StringPlan => {
  const charBits = (n: number) => bitsForEnumArrayContent(n, alphabetSize);
  const ops: StringOp[] = [];
  let bits = 0;
  for (const { seen, repeat, chars, affix } of slots) {
    if (backRefs && seen) {
      bits += 1;
      if (repeat !== undefined) {
        bits += bitsForRange(seen);
        ops.push({ kind: 'repeat', seen, index: repeat });
        continue;
      }
    }
    let op: StringOp = { kind: 'plain', seen, chars };
    let cost = uBits(chars.length) + charBits(chars.length);
    if (affixes && seen) {
      bits += 1;
      if (affix) {
        const rest = chars.length - affix.shared;
        const c = bitsForRange(seen) + 1 + uBits(affix.shared - MIN_AFFIX) + uBits(rest) + charBits(rest);
        if (c < cost) {
          cost = c;
          op = { kind: 'affix', seen, ...affix, chars: affix.suffix ? chars.slice(0, rest) : chars.slice(affix.shared) };
        }
      }
    }
    bits += cost;
    ops.push(op);
  }
  return { backRefs, affixes, ops, bits };
};

const writeStringOp = (w: BitWriter, plan: StringPlan, op: StringOp, size: number) => {
  if (plan.backRefs && op.seen) w.writeUInt(op.kind === 'repeat' ? 1 : 0, 1);
  if (op.kind === 'repeat') return w.writeUInt(op.index, bitsForRange(op.seen));
  if (plan.affixes && op.seen) w.writeUInt(op.kind === 'affix' ? 1 : 0, 1);
  if (op.kind === 'affix') {
    w.writeUInt(op.index, bitsForRange(op.seen));
    w.writeUInt(op.suffix ? 1 : 0, 1);
    writeU(w, op.shared - MIN_AFFIX);
  }
  writeU(w, op.chars.length);
  const base = BigInt(size);
  w.writeUInt(
    op.chars.reduce((acc, c) => acc * base + BigInt(c), 0n),
    bitsForEnumArrayContent(op.chars.length, size)
  );
};

/* =========================
 * Structure
 * ========================= */

/** Every optional field in the order the structure is written: templates, then fields, depth first */
const collectOptionals = (schema: DenseSchema): OptionalField[] => {
  const out: OptionalField[] = [];
  const walk = (field: DenseField) => {
    switch (field.type) {
      case 'optional':
        out.push(field);
        walk(field.field);
        break;
      case 'object':
        field.fields.forEach(walk);
        break;
      case 'array':
        walk(field.items);
        break;
      case 'union':
        field.discriminator.options.forEach((option) => field.variants[option].forEach(walk));
        break;
      default:
        break;
    }
  };
  (schema.templates ?? []).forEach(walk);
  schema.fields.forEach(walk);
  return out;
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k]))
  );
};

/** How an optional's default is stored: densed only when that gives the value back exactly */
const optionalDefault = (field: OptionalField, schema: DenseSchema): OptionalDefault => {
  if (field.defaultValue === undefined) return OptionalDefault.Undefined;
  if (field.defaultValue === null) return OptionalDefault.Null;
  try {
    const w = new BitWriter();
    densingField(w, field.field, field.defaultValue, schema, 'default');
    const r = BitReader.getFromBase(w.getFromBase('binary'), 'binary');
    if (deepEqual(undensingField(r, field.field, schema, 'default'), field.defaultValue)) return OptionalDefault.Dense;
  } catch {
    // not encodable with the inner field: stored as JSON
  }
  return OptionalDefault.Json;
};

interface WriteContext {
  schema: DenseSchema;
  definitionIndex: Map<string, number>;
}

/** A number stored exactly when `exact`, otherwise as a raw float64 behind a flag bit */
const exactOr = (out: Out, exact: boolean, writeExact: () => void, value: number) => {
  out.exact(exact);
  if (exact) writeExact();
  else out.F(value);
};

const writeInt = (out: Out, min: number, max: number, defaultValue: number) => {
  out.I(min);
  out.U(max - min);
  out.uint(defaultValue === min ? 0 : 1, 1);
  if (defaultValue !== min) out.uint(defaultValue - min, bitsForRange(max - min + 1));
};

const writeFixed = (out: Out, field: Pick<FixedPointField, 'min' | 'max' | 'precision' | 'defaultValue'>) => {
  const { min, max, precision, defaultValue } = field;
  const scale = Math.round(1 / precision);
  exactOr(out, 1 / scale === precision, () => out.U(scale - 1), precision);
  const minSteps = Math.round(min * scale);
  exactOr(out, minSteps / scale === min, () => out.I(minSteps), min);
  const maxStep = fixedMaxStep(min, max, precision);
  exactOr(out, (minSteps + maxStep) / scale === max, () => out.U(maxStep), max);
  out.uint(defaultValue === min ? 0 : 1, 1);
  if (defaultValue !== min) {
    const fixedField = { type: 'fixed', name: '', min, max, precision, defaultValue } as FixedPointField;
    const step = uIntForFixed(fixedField, defaultValue);
    const exact = step >= 0 && step <= maxStep && fixedFromUInt(fixedField, step) === defaultValue;
    exactOr(out, exact, () => out.uint(step, bitsForRange(maxStep + 1)), defaultValue);
  }
};

const writeEnum = (out: Out, field: EnumField) => {
  out.S(field.name);
  out.U(field.options.length - 2);
  field.options.forEach((option) => out.S(option));
  const index = field.options.indexOf(field.defaultValue);
  out.uint(index === 0 ? 0 : 1, 1);
  if (index !== 0) out.uint(index, bitsForRange(field.options.length));
};

const writeField = (out: Out, field: DenseField, ctx: WriteContext): void => {
  out.uint(FieldTypes.indexOf(field.type), TYPE_BITS);
  if (field.type === 'enum') return writeEnum(out, field);
  out.S(field.name);
  switch (field.type) {
    case 'bool':
      return out.uint(field.defaultValue ? 1 : 0, 1);
    case 'int':
      return writeInt(out, field.min, field.max, field.defaultValue);
    case 'fixed':
      return writeFixed(out, field);
    case 'enum_array': {
      writeEnum(out, field.enum);
      out.U(field.minLength);
      out.U(field.maxLength - field.minLength);
      const builderDefault = Array.from({ length: field.minLength }, () => field.enum.defaultValue);
      const isBuilderDefault = deepEqual(field.defaultValue, builderDefault);
      out.uint(isBuilderDefault ? 0 : 1, 1);
      if (!isBuilderDefault) {
        out.uint(field.defaultValue.length - field.minLength, bitsForRange(field.maxLength - field.minLength + 1));
        field.defaultValue.forEach((v) => out.uint(field.enum.options.indexOf(v), bitsForRange(field.enum.options.length)));
      }
      return;
    }
    case 'array':
      out.U(field.minLength);
      out.U(field.maxLength - field.minLength);
      return writeField(out, field.items, ctx);
    case 'object':
      out.U(field.fields.length);
      return field.fields.forEach((f) => writeField(out, f, ctx));
    case 'union':
      writeEnum(out, field.discriminator);
      return field.discriminator.options.forEach((option) => {
        out.U(field.variants[option].length);
        field.variants[option].forEach((f) => writeField(out, f, ctx));
      });
    case 'optional':
      out.uint(optionalDefault(field, ctx.schema), 2);
      return writeField(out, field.field, ctx);
    case 'pointer':
      return out.S(field.targetName);
    case 'reference_numeric':
      return out.uint(ctx.definitionIndex.get(field.ref)!, bitsForRange(ctx.definitionIndex.size));
    case 'reference':
      return out.uint(field.ref, bitsForRange(ctx.schema.templates?.length ?? 0));
    default:
      return assertNeverDenseField(field);
  }
};

const writeDefinition = (out: Out, definition: NumericDefinition) => {
  out.S(definition.name);
  const names = Object.keys(definition.presets);
  out.U(names.length - 1);
  for (const name of names) {
    out.S(name);
    const preset = definition.presets[name];
    const defaultValue = preset.defaultValue ?? preset.min;
    out.uint(preset.precision === undefined ? 0 : 1, 1);
    if (preset.precision === undefined) writeInt(out, preset.min, preset.max, defaultValue);
    else writeFixed(out, { min: preset.min, max: preset.max, precision: preset.precision, defaultValue });
  }
  const index = names.indexOf(definition.defaultPreset ?? names[0]);
  out.uint(index === 0 ? 0 : 1, 1);
  if (index !== 0) out.uint(index, bitsForRange(names.length));
};

/** Everything after the header: definitions, templates, fields, then the deferred optional defaults */
const writeBody = (out: Out, schema: DenseSchema) => {
  const ctx: WriteContext = {
    schema,
    definitionIndex: new Map((schema.definitions ?? []).map((d, i) => [d.name, i]))
  };
  if (schema.definitions) {
    out.U(schema.definitions.length);
    schema.definitions.forEach((d) => writeDefinition(out, d));
  }
  if (schema.templates) {
    out.U(schema.templates.length);
    schema.templates.forEach((t) => writeField(out, t, ctx));
  }
  out.U(schema.fields.length);
  schema.fields.forEach((f) => writeField(out, f, ctx));
  for (const field of collectOptionals(schema)) {
    const state = optionalDefault(field, schema);
    if (state === OptionalDefault.Dense) out.dense(field.field, field.defaultValue);
    else if (state === OptionalDefault.Json) out.S(JSON.stringify(field.defaultValue));
  }
};

/**
 * Encode a whole schema (fields, templates, numeric definitions, defaults) as a compact string, e.g.
 * to put a schema next to its data in a URL. `undensingSchema` reverses it.
 * @throws when the schema is not valid (`validateSchema`)
 */
export const densingSchema = (schema: DenseSchema, base: BaseSpec = 'base64url'): string =>
  encodeSchema(schema).writer.getFromBase(base);

const writeAlphabet = (w: BitWriter, alphabet: Alphabet) => {
  writeU(w, alphabet.codePoints.length);
  alphabet.codePoints.forEach((cp, i) => writeU(w, i ? cp - alphabet.codePoints[i - 1] - 1 : cp));
};

const encodeSchema = (schema: DenseSchema) => {
  assertValidSchema(schema);
  const collector = new CollectOut();
  writeBody(collector, schema);
  const alphabet = buildAlphabet(collector.strings);
  const slots = analyzeStrings(collector.strings, alphabet);
  // the four combinations of the two string features; the shortest wins, ties to the simplest
  const plan = [
    [false, false],
    [true, false],
    [false, true],
    [true, true]
  ]
    .map(([backRefs, affixes]) => planStrings(slots, alphabet.codePoints.length, backRefs, affixes))
    .reduce((best, p) => (p.bits < best.bits ? p : best));

  const w = new BitWriter();
  w.writeUInt(VERSION, VERSION_BITS);
  w.writeUInt(schema.definitions ? 1 : 0, 1);
  w.writeUInt(schema.templates ? 1 : 0, 1);
  w.writeUInt(plan.backRefs ? 1 : 0, 1);
  w.writeUInt(plan.affixes ? 1 : 0, 1);
  writeAlphabet(w, alphabet);
  writeBody(new WriteOut(w, plan, alphabet, schema), schema);
  return { writer: w, collector, alphabet, plan };
};

/**
 * Where the bits of an encoded schema go (for tests and the benchmark): the whole payload, the string
 * section (alphabet + strings) against the strings' UTF-8 size, and how many numbers needed the
 * float64 fallback.
 */
export const schemaEncodingStats = (
  schema: DenseSchema
): {
  bits: number;
  stringBits: number;
  stringUtf8Bits: number;
  alphabetSize: number;
  backRefs: boolean;
  affixes: boolean;
  numbers: number;
  floatFallbacks: number;
} => {
  const { writer, collector, alphabet, plan } = encodeSchema(schema);
  const alphabetWriter = new BitWriter();
  writeAlphabet(alphabetWriter, alphabet);
  return {
    bits: writer.getBitLength(),
    stringBits: alphabetWriter.getBitLength() + plan.bits,
    stringUtf8Bits: collector.strings.reduce((sum, s) => sum + 8 * new TextEncoder().encode(s).length, 0),
    alphabetSize: alphabet.codePoints.length,
    backRefs: plan.backRefs,
    affixes: plan.affixes,
    numbers: collector.numbers,
    floatFallbacks: collector.floatFallbacks
  };
};

/* =========================
 * Reading
 * ========================= */

type Json = Record<string, unknown>;

class Reader {
  private readonly seen: number[][] = [];
  private readonly seenStrings = new Set<string>();
  private alphabet: number[] = [];
  private backRefs = false;
  private affixes = false;
  readonly optionals: { node: Json; state: OptionalDefault }[] = [];
  definitionNames: string[] = [];
  templateCount = 0;

  constructor(readonly r: BitReader) {}

  fail(path: string, message: string): never {
    throw new DenseDecodeError(path, message);
  }

  uint(bits: number, path: string): number {
    try {
      return this.r.readUInt(bits);
    } catch (error) {
      if (error instanceof DenseDecodeError && !error.path) this.fail(path, error.message);
      throw error;
    }
  }

  big(bits: number, path: string): bigint {
    try {
      return this.r.readUBigInt(bits);
    } catch (error) {
      if (error instanceof DenseDecodeError && !error.path) this.fail(path, error.message);
      throw error;
    }
  }

  /** an index below `count` */
  index(count: number, path: string, what: string): number {
    const i = this.uint(bitsForRange(count), path);
    if (i >= count) this.fail(path, `${what} ${i} does not exist (${count} available)`);
    return i;
  }

  U(path: string): number {
    let zeros = 0;
    while (this.uint(1, path) === 0) if (++zeros > 5) this.fail(path, 'number too large');
    const length = zeros ? (1 << zeros) | this.uint(zeros, path) : 1;
    if (length > 54) this.fail(path, 'number too large');
    const v = (1n << BigInt(length - 1)) | this.big(length - 1, path);
    if (v - 1n > BigInt(Number.MAX_SAFE_INTEGER)) this.fail(path, 'number too large');
    return Number(v - 1n);
  }

  /** U for a count of items that each take at least one bit */
  count(path: string, offset = 0): number {
    const n = this.U(path) + offset;
    if (n > this.r.getBitsLeft() + offset) this.fail(path, `count ${n} exceeds the remaining input`);
    return n;
  }

  I(path: string): number {
    const negative = this.uint(1, path) === 1;
    const magnitude = this.U(path);
    return negative ? -magnitude : magnitude;
  }

  F(path: string): number {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, this.big(64, path));
    return view.getFloat64(0);
  }

  header(path: string) {
    this.backRefs = this.uint(1, path) === 1;
    this.affixes = this.uint(1, path) === 1;
    const n = this.count(`${path}.alphabet`);
    for (let i = 0; i < n; i++) {
      const cp = i ? this.alphabet[i - 1] + 1 + this.U(`${path}.alphabet`) : this.U(`${path}.alphabet`);
      if (cp > MAX_CODE_POINT) this.fail(`${path}.alphabet`, `code point ${cp} is outside Unicode`);
      this.alphabet.push(cp);
    }
  }

  S(path: string): string {
    const before = this.seen.length;
    if (this.backRefs && before && this.uint(1, path) === 1) {
      return String.fromCodePoint(...this.seen[this.index(before, path, 'string')]);
    }
    let prefix: number[] = [];
    let suffix: number[] = [];
    if (this.affixes && before && this.uint(1, path) === 1) {
      const other = this.seen[this.index(before, path, 'string')];
      const isSuffix = this.uint(1, path) === 1;
      const shared = this.U(path) + MIN_AFFIX;
      if (shared > other.length) this.fail(path, `cannot share ${shared} characters of a ${other.length} character string`);
      if (isSuffix) suffix = other.slice(other.length - shared);
      else prefix = other.slice(0, shared);
    }
    const size = this.alphabet.length;
    const length = this.U(path);
    if (size <= 1 ? length > MAX_FREE_STRING : length > this.r.getBitsLeft())
      this.fail(path, `string length ${length} exceeds the remaining input`);
    if (length && !size) this.fail(path, 'string characters without an alphabet');
    let value = this.big(bitsForEnumArrayContent(length, size), path);
    const base = BigInt(size);
    if (length && value >= base ** BigInt(length)) this.fail(path, 'string characters outside the alphabet');
    const chars: number[] = new Array(length);
    for (let i = length - 1; i >= 0; i--) {
      chars[i] = this.alphabet[Number(value % base)];
      value /= base;
    }
    const cps = [...prefix, ...chars, ...suffix];
    const s = String.fromCodePoint(...cps);
    if (!this.seenStrings.has(s)) {
      this.seenStrings.add(s);
      this.seen.push(cps);
    }
    return s;
  }

  int(path: string): { min: number; max: number; defaultValue: number } {
    const min = this.I(path);
    const range = this.U(path);
    if (range >= 2 ** MAX_FIELD_BITS) this.fail(path, `range ${range} needs more than ${MAX_FIELD_BITS} bits`);
    const max = min + range;
    const defaultValue = this.uint(1, path) ? min + this.uint(bitsForRange(max - min + 1), path) : min;
    return { min, max, defaultValue };
  }

  fixed(path: string): { min: number; max: number; precision: number; defaultValue: number } {
    const exact = <T>(read: () => T, raw: () => number): T | number => (this.uint(1, path) ? raw() : read());
    const precision = exact(() => 1 / (this.U(path) + 1), () => this.F(path));
    const scale = Math.round(1 / precision);
    const min = exact(() => this.I(path) / scale, () => this.F(path));
    const max = exact(() => (Math.round(min * scale) + this.U(path)) / scale, () => this.F(path));
    if (!Number.isFinite(precision) || !Number.isFinite(min) || !Number.isFinite(max) || precision <= 0 || max < min)
      this.fail(path, 'invalid fixed-point range');
    const maxStep = fixedMaxStep(min, max, precision);
    if (!Number.isSafeInteger(maxStep) || maxStep >= 2 ** MAX_FIELD_BITS) this.fail(path, 'invalid fixed-point range');
    const field = { type: 'fixed', name: '', min, max, precision, defaultValue: min } as FixedPointField;
    const defaultValue = this.uint(1, path)
      ? exact(() => fixedFromUInt(field, this.uint(bitsForRange(maxStep + 1), path)), () => this.F(path))
      : min;
    return { min, max, precision, defaultValue };
  }

  enumBody(name: string, path: string): Json {
    const count = this.count(path, 2);
    const options = Array.from({ length: count }, () => this.S(path));
    const index = this.uint(1, path) ? this.index(count, path, 'option') : 0;
    return { type: 'enum', name, options, defaultValue: options[index] };
  }

  field(path: string, depth: number): Json {
    if (depth > MAX_DEPTH) this.fail(path, `nesting deeper than ${MAX_DEPTH}`);
    const typeIndex = this.uint(TYPE_BITS, path);
    const type = FieldTypes[typeIndex];
    if (!type) this.fail(path, `unknown field type ${typeIndex}`);
    const name = this.S(path);
    const at = `${path}.${name}`;
    switch (type) {
      case 'bool':
        return { type, name, defaultValue: this.uint(1, at) === 1 };
      case 'int':
        return { type, name, ...this.int(at) };
      case 'fixed':
        return { type, name, ...this.fixed(at) };
      case 'enum':
        return this.enumBody(name, at);
      case 'enum_array': {
        const enumField = this.enumBody(this.S(at), at);
        const minLength = this.U(at);
        // the builder default has minLength values: bound it before allocating
        if (minLength > MAX_FREE_STRING) this.fail(at, `minLength ${minLength} is too large`);
        const maxLength = minLength + this.U(at);
        const options = enumField.options as string[];
        const defaultValue = this.uint(1, at)
          ? Array.from({ length: minLength + this.uint(bitsForRange(maxLength - minLength + 1), at) }, () => options[this.index(options.length, at, 'option')])
          : Array.from({ length: minLength }, () => enumField.defaultValue);
        return { type, name, enum: enumField, minLength, maxLength, defaultValue };
      }
      case 'array': {
        const minLength = this.U(at);
        const maxLength = minLength + this.U(at);
        return { type, name, minLength, maxLength, items: this.field(at, depth + 1) };
      }
      case 'object':
        return { type, name, fields: this.fields(at, depth + 1) };
      case 'union': {
        const discriminator = this.enumBody(this.S(at), at);
        const variants = Object.fromEntries((discriminator.options as string[]).map((option) => [option, this.fields(`${at}.${option}`, depth + 1)]));
        return { type, name, discriminator, variants };
      }
      case 'optional': {
        const state = this.uint(2, at) as OptionalDefault;
        const node: Json = { type, name };
        this.optionals.push({ node, state });
        node.field = this.field(at, depth + 1);
        if (state === OptionalDefault.Null) node.defaultValue = null;
        return node;
      }
      case 'pointer':
        return { type, name, targetName: this.S(at) };
      case 'reference_numeric':
        return { type, name, ref: this.definitionNames[this.index(this.definitionNames.length, at, 'definition')] };
      case 'reference':
        return { type, name, ref: this.index(this.templateCount, at, 'template') };
      default:
        return assertNeverDenseField(type as never);
    }
  }

  fields(path: string, depth: number): Json[] {
    const count = this.count(path);
    return Array.from({ length: count }, () => this.field(path, depth));
  }

  definition(path: string): Json {
    const name = this.S(path);
    const count = this.count(path, 1);
    const presets = Object.fromEntries(
      Array.from({ length: count }, () => {
        const presetName = this.S(path);
        const isFixed = this.uint(1, path) === 1;
        return [presetName, isFixed ? this.fixed(`${path}.${presetName}`) : this.int(`${path}.${presetName}`)];
      })
    );
    const names = Object.keys(presets);
    const defaultPreset = this.uint(1, path) ? names[this.index(count, path, 'preset')] : names[0];
    return { name, presets, defaultPreset };
  }
}

/**
 * Decode a schema written by `densingSchema`. The result is rebuilt with the builders (like
 * `schemaFromJson`), so it is checked and normalised the same way.
 * @throws DenseDecodeError when the string is not a valid encoded schema, or an "Invalid schema" error
 * when it decodes to a schema the builders reject
 */
export const undensingSchema = (encoded: string, base: BaseSpec = 'base64url'): DenseSchema => {
  const reader = new Reader(BitReader.getFromBase(encoded, base));
  const version = reader.uint(VERSION_BITS, 'version');
  if (version !== VERSION) reader.fail('version', `unsupported schema encoding version ${version}`);
  const hasDefinitions = reader.uint(1, 'header') === 1;
  const hasTemplates = reader.uint(1, 'header') === 1;
  reader.header('header');

  const json: Json = {};
  if (hasDefinitions) {
    const count = reader.count('definitions');
    const definitions = Array.from({ length: count }, (_, i) => reader.definition(`definitions[${i}]`));
    reader.definitionNames = definitions.map((d) => d.name as string);
    json.definitions = definitions;
  }
  if (hasTemplates) {
    reader.templateCount = reader.count('templates');
    json.templates = Array.from({ length: reader.templateCount }, (_, i) => reader.field(`templates[${i}]`, 0));
  }
  json.fields = reader.fields('fields', 0);

  const deferred = reader.optionals.filter((o) => o.state >= OptionalDefault.Dense);
  if (deferred.length) {
    // values need the rebuilt schema: their inner fields may refer to templates and pointer targets
    const structure = schemaFromJson(json);
    const optionals = collectOptionals(structure);
    reader.optionals.forEach(({ node, state }, i) => {
      if (state === OptionalDefault.Dense)
        node.defaultValue = undensingField(reader.r, optionals[i].field, structure, `${node.name}.default`);
      else if (state === OptionalDefault.Json) {
        const text = reader.S(`${node.name}.default`);
        try {
          node.defaultValue = JSON.parse(text);
        } catch {
          reader.fail(`${node.name}.default`, 'default value is not valid JSON');
        }
      }
    });
  }
  reader.r.assertCanonicalEnd();
  return schemaFromJson(json);
};
