// codec.ts
import { BitWriter, BitReader } from './codec/bits';
import { BaseSpec } from './encoding/alphabets';
import { bitsForDigits } from './encoding/radix';
import { DenseSchema, DenseField, ConstantBitWidthField, assertNeverDenseField } from './schema-type';
import { resolvePointerOrThrow } from './schema/resolve';
import { DenseDecodeError, DenseEncodeError } from './errors';
import {
  constantFieldValueError,
  fixedFromUInt,
  fixedMaxStep,
  lengthError,
  uIntForFixed
} from './values';

// bit-width helper methods
/**
 * Bits needed for `range` distinct values: the bit length of `range - 1`. Integer arithmetic only:
 * `Math.ceil(Math.log2(range))` under-counts by one bit just above large powers of two (2^49 + 1).
 */
export const bitsForRange = (range: number): number => (range <= 1 ? 0 : (range - 1).toString(2).length);
const bitsForInt = (min: number, max: number): number => bitsForRange(Math.round(max - min) + 1);
const bitsForFixed = (min: number, max: number, precision: number): number =>
  bitsForRange(fixedMaxStep(min, max, precision) + 1);

// array length helpers
export const bitsForMinMaxLength = (minLength: number, maxLength: number): number =>
  bitsForRange(maxLength - minLength + 1);
const uIntForMinMaxLength = (value: number, minLength: number): number => value - minLength;
export const lengthForUIntMinMaxLength = (uInt: number, minLength: number): number => uInt + minLength;
/** Bits of an enum array's content: `length` digits in base `base` (see FORMAT.md) */
export const bitsForEnumArrayContent = (length: number, base: number): number => bitsForDigits(length, base);

// options helper methods
export const bitsForOptions = (options: readonly string[]): number => bitsForRange(options.length);
const sizeForOptions = (options: readonly string[]): number => options.length;

/**
 * Densing method - key method to dense (pack into encoded string) the data for a given schema into a string of a specific base
 * @param denseSchema - The schema to dense the data for
 * @param data - The data to dense
 * @param base - The base as string of characters, where every symbol is interpreted as a specific value
 * @returns The dense string in the given base
 * @throws DenseEncodeError when the data does not match the schema (the same rules `validate()` checks)
 */
export const densing = (denseSchema: DenseSchema, data: any, base: BaseSpec = 'base64url'): string => {
  if (typeof data !== 'object' || data === null) throw new DenseEncodeError('', 'expected object');
  const w = new BitWriter();
  denseSchema.fields.forEach((f) => densingField(w, f, data[f.name], denseSchema, f.name));
  return w.getFromBase(base);
};

/**
 * The unsigned integer stored for a constant-width field
 * @throws DenseEncodeError when the value is not valid for the field
 */
export const getUIntForConstantBitWidthField = (
  field: ConstantBitWidthField,
  value: any,
  path: string = field.name
): number => {
  const error = constantFieldValueError(field, value);
  if (error) throw new DenseEncodeError(path, error);

  switch (field.type) {
    case 'bool':
      return value ? 1 : 0;
    case 'int':
      return value - field.min;
    case 'enum':
      return field.options.indexOf(value);
    case 'fixed':
      return uIntForFixed(field, value);
    default:
      return assertNeverDenseField(field);
  }
};

export const getBitWidthForContantBitWidthFields = (field: ConstantBitWidthField): number => {
  switch (field.type) {
    case 'bool':
      return 1;
    case 'int':
      return bitsForInt(field.min, field.max);
    case 'enum':
      return bitsForOptions(field.options);
    case 'fixed':
      return bitsForFixed(field.min, field.max, field.precision);
    default:
      return assertNeverDenseField(field);
  }
};

const writeLength = (w: BitWriter, length: number, minLength: number, maxLength: number, path: string) => {
  const error = lengthError(length, minLength, maxLength);
  if (error) throw new DenseEncodeError(path, error);
  w.writeUInt(uIntForMinMaxLength(length, minLength), bitsForMinMaxLength(minLength, maxLength));
};

/**
 * Helper method to dense a single field of the schema into the given bit writer
 * @param w - The bit writer to write the dense data to
 * @param field - The field used as the template to dense the value with
 * @param value - The value to dense
 * @param schema - The root schema (for resolving pointers)
 * @param path - Path of the value, used in error messages
 * @throws DenseEncodeError when the value does not match the field
 */
export const densingField = (
  w: BitWriter,
  field: DenseField,
  value: any,
  schema?: DenseSchema,
  path: string = field.name
): void => {
  if (value === undefined && field.type !== 'optional') throw new DenseEncodeError(path, 'missing value');

  switch (field.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed':
      w.writeUInt(getUIntForConstantBitWidthField(field, value, path), getBitWidthForContantBitWidthFields(field));
      break;

    case 'array': {
      if (!Array.isArray(value)) throw new DenseEncodeError(path, 'expected array');
      writeLength(w, value.length, field.minLength, field.maxLength, path);
      value.forEach((v, i) => densingField(w, field.items, v, schema, `${path}[${i}]`));
      break;
    }

    case 'union': {
      if (typeof value !== 'object' || value === null) throw new DenseEncodeError(path, 'expected object');
      const { discriminator } = field;
      const discValue = value[discriminator.name];
      const discIdx = discriminator.options.indexOf(discValue);
      if (discIdx === -1)
        throw new DenseEncodeError(
          `${path}.${discriminator.name}`,
          `invalid discriminator "${discValue}", expected one of [${discriminator.options.join(', ')}]`
        );
      w.writeUInt(discIdx, bitsForOptions(discriminator.options));
      field.variants[discValue].forEach((f) => densingField(w, f, value[f.name], schema, `${path}.${f.name}`));
      break;
    }

    case 'enum_array': {
      if (!Array.isArray(value)) throw new DenseEncodeError(path, 'expected array');
      writeLength(w, value.length, field.minLength, field.maxLength, path);

      const base = BigInt(sizeForOptions(field.enum.options));
      const result = value.reduce((acc: bigint, c: unknown, i: number) => {
        const error = constantFieldValueError(field.enum, c);
        if (error) throw new DenseEncodeError(`${path}[${i}]`, error);
        return acc * base + BigInt(field.enum.options.indexOf(c as string));
      }, 0n);
      w.writeUInt(result, bitsForEnumArrayContent(value.length, sizeForOptions(field.enum.options)));
      break;
    }

    case 'optional': {
      const isPresent = value !== undefined && value !== null;
      w.writeUInt(isPresent ? 1 : 0, 1);
      if (isPresent) densingField(w, field.field, value, schema, path);
      break;
    }

    case 'object': {
      if (typeof value !== 'object' || value === null) throw new DenseEncodeError(path, 'expected object');
      field.fields.forEach((f) => densingField(w, f, value[f.name], schema, `${path}.${f.name}`));
      break;
    }

    case 'pointer':
      densingField(w, resolvePointerOrThrow(field, schema), value, schema, path);
      break;

    default:
      assertNeverDenseField(field);
  }
};

/**
 * Undensing method - key method to undense (unpack from encoded string) the data for a given schema from a string of a specific base
 * @param denseSchema - The schema to undense the data for
 * @param baseString - The dense string to undense
 * @param base - The base as string of characters, where every symbol is interpreted as a specific value
 * @returns The undense data
 * @throws DenseDecodeError when the string is not a payload `densing` could have produced for this
 * schema (wrong characters, values outside a field's range, too few or too many characters, ...)
 */
export const undensing = (denseSchema: DenseSchema, baseString: string, base: BaseSpec = 'base64url'): any => {
  const r = BitReader.getFromBase(baseString, base);
  const obj: any = {};
  denseSchema.fields.forEach((f) => (obj[f.name] = undensingField(r, f, denseSchema, f.name)));
  r.assertCanonicalEnd();
  return obj;
};

export const undensingDataForConstantBitWidthField = (field: ConstantBitWidthField, unsignedInt: number): any => {
  switch (field.type) {
    case 'bool':
      return Boolean(unsignedInt);
    case 'int':
      return unsignedInt + field.min;
    case 'enum':
      return field.options[unsignedInt];
    case 'fixed':
      return fixedFromUInt(field, unsignedInt);
    default:
      return assertNeverDenseField(field);
  }
};

/** Largest unsigned integer the encoder writes for a constant-width field */
const maxUIntForConstantBitWidthField = (field: ConstantBitWidthField): number => {
  switch (field.type) {
    case 'bool':
      return 1;
    case 'int':
      return field.max - field.min;
    case 'enum':
      return field.options.length - 1;
    case 'fixed':
      return fixedMaxStep(field.min, field.max, field.precision);
    default:
      return assertNeverDenseField(field);
  }
};

/** Read from `r`, attaching `path` to an end-of-input error */
const readAt = <T>(path: string, read: () => T): T => {
  try {
    return read();
  } catch (e) {
    if (e instanceof DenseDecodeError && !e.path) throw new DenseDecodeError(path, e.message);
    throw e;
  }
};

const readLength = (r: BitReader, minLength: number, maxLength: number, path: string): number => {
  const length = lengthForUIntMinMaxLength(
    readAt(path, () => r.readUInt(bitsForMinMaxLength(minLength, maxLength))),
    minLength
  );
  const error = lengthError(length, minLength, maxLength);
  if (error) throw new DenseDecodeError(path, error);
  return length;
};

/**
 * Internal Helper method to undense a single field of the schema from the given bit reader
 * @param r - The bit reader to read the dense data from
 * @param denseField - The field used as the template to undense the value with
 * @param schema - The root schema (for resolving pointers)
 * @param path - Path of the value, used in error messages
 * @returns The undense value
 * @throws DenseDecodeError when the bits cannot have been written by the encoder for this field
 */
export const undensingField = (
  r: BitReader,
  denseField: DenseField,
  schema?: DenseSchema,
  path: string = denseField.name
): any => {
  switch (denseField.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed': {
      const uInt = readAt(path, () => r.readUInt(getBitWidthForContantBitWidthFields(denseField)));
      const max = maxUIntForConstantBitWidthField(denseField);
      if (uInt > max)
        throw new DenseDecodeError(path, `stored value ${uInt} exceeds the field's maximum ${max}`);
      return undensingDataForConstantBitWidthField(denseField, uInt);
    }

    case 'array': {
      const length = readLength(r, denseField.minLength, denseField.maxLength, path);
      return Array.from({ length }, (_, i) => undensingField(r, denseField.items, schema, `${path}[${i}]`));
    }

    case 'union': {
      const { discriminator } = denseField;
      const discPath = `${path}.${discriminator.name}`;
      const idx = readAt(discPath, () => r.readUInt(bitsForOptions(discriminator.options)));
      if (idx >= discriminator.options.length)
        throw new DenseDecodeError(discPath, `discriminator index ${idx} exceeds the ${discriminator.options.length} options`);
      const key = discriminator.options[idx];
      const obj: any = { [discriminator.name]: key };
      denseField.variants[key].forEach((f) => (obj[f.name] = undensingField(r, f, schema, `${path}.${f.name}`)));
      return obj;
    }

    case 'enum_array': {
      const { options } = denseField.enum;
      const base = BigInt(sizeForOptions(options));
      const length = readLength(r, denseField.minLength, denseField.maxLength, path);
      const contentBits = bitsForEnumArrayContent(length, sizeForOptions(options));

      let bigIntValue = readAt(path, () => r.readUBigInt(contentBits));
      if (bigIntValue >= base ** BigInt(length))
        throw new DenseDecodeError(path, `content does not encode ${length} values of ${options.length} options`);

      const result: string[] = [];
      for (let i = 0; i < length; i++) {
        // always use BigInt modulo and division
        const idx = Number(bigIntValue % base); // convert index to number for enum lookup
        result.unshift(options[idx]); // unshift to reverse the order (most significant digit first)
        bigIntValue = bigIntValue / base;
      }

      return result;
    }

    case 'optional':
      return readAt(path, () => r.readUInt(1))
        ? undensingField(r, denseField.field, schema, path)
        : denseField.defaultValue !== undefined
        ? denseField.defaultValue
        : null;

    case 'object':
      return Object.fromEntries(
        denseField.fields.map((f) => [f.name, undensingField(r, f, schema, `${path}.${f.name}`)])
      );

    case 'pointer':
      return undensingField(r, resolvePointerOrThrow(denseField, schema), schema, path);

    default:
      return assertNeverDenseField(denseField);
  }
};
