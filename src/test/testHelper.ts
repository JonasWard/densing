import { BitReader, BitWriter } from '../helpers';
import { DenseField, DenseSchema } from '../schema-type';
import { undensingField as originalEncodeField, densingField as originalDecodeField } from '../densing';

// Import only the helper functions we need for recursive types
const bitsForRange = (range: number) => (range <= 1 ? 0 : Math.ceil(Math.log2(range)));
const bitsForMinMaxLength = (minLength: number, maxLength: number) => bitsForRange(maxLength - minLength);
const lengthForUIntMinMaxLength = (uInt: number, minLength: number) => uInt + minLength;
const bitsForOptions = (options: readonly string[]) => bitsForRange(options.length);

/**
 * Internal encode function with logging support
 * Only handles recursive types; delegates simple types to original codec
 */
function encodeFieldWithLogging(
  w: BitWriter,
  field: DenseField,
  value: any,
  optionalLogAttributes: string[],
  depth: number = 0
): void {
  const indent = '  '.repeat(depth);
  const shouldLog = optionalLogAttributes.includes(field.name);

  if (shouldLog) {
    console.log(`${indent}→ Encoding field "${field.name}" (${field.type}):`, value);
  }

  try {
    // Handle recursive types that need to use the wrapper
    if (field.type === 'array') {
      if (!Array.isArray(value)) throw new Error('value of `array` is not an array');
      const arrayLengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (arrayLengthBits !== 0) w.writeUInt((value as any[]).length, arrayLengthBits);
      (value as any[]).forEach((v) => {
        encodeFieldWithLogging(w, field.items, v, optionalLogAttributes, depth + 1);
      });
    } else if (field.type === 'union') {
      const discValue = value[field.discriminator.name];
      const discIdx = field.discriminator.options.indexOf(discValue);
      if (discIdx === -1) throw new Error(`Invalid union discriminator value: ${discValue}`);
      w.writeUInt(discIdx, bitsForOptions(field.discriminator.options));
      field.variants[discValue].forEach((f) =>
        encodeFieldWithLogging(w, f, value[f.name], optionalLogAttributes, depth + 1)
      );
    } else if (field.type === 'optional') {
      const isPresent = value !== undefined && value !== null;
      w.writeUInt(isPresent ? 1 : 0, 1);
      if (isPresent) {
        encodeFieldWithLogging(w, field.field, value, optionalLogAttributes, depth + 1);
      }
    } else if (field.type === 'object') {
      if (typeof value !== 'object' || value === null) throw new Error('value of `object` is not an object');
      field.fields.forEach((f) => encodeFieldWithLogging(w, f, value[f.name], optionalLogAttributes, depth + 1));
    } else {
      // For all simple types (bool, int, enum, fixed, enum_array), use original codec
      originalEncodeField(w, field, value);
    }

    if (shouldLog) {
      console.log(`${indent}✓ Encoded field "${field.name}"`);
    }
  } catch (error) {
    console.error(`${indent}✗ Error encoding field "${field.name}" (${field.type}):`, error);
    throw error;
  }
}

/**
 * Internal decode function with logging support
 * Only handles recursive types; delegates simple types to original codec
 */
function decodeFieldWithLogging(
  r: BitReader,
  field: DenseField,
  optionalLogAttributes: string[],
  depth: number = 0
): any {
  const indent = '  '.repeat(depth);
  const shouldLog = optionalLogAttributes.includes(field.name);

  if (shouldLog) {
    console.log(`${indent}→ Decoding field "${field.name}" (${field.type})`);
  }

  try {
    let result: any;

    // Handle recursive types that need to use the wrapper
    if (field.type === 'array') {
      const length = lengthForUIntMinMaxLength(
        r.readUInt(bitsForMinMaxLength(field.minLength, field.maxLength)),
        field.minLength
      );
      result = Array.from({ length }, () => decodeFieldWithLogging(r, field.items, optionalLogAttributes, depth + 1));
    } else if (field.type === 'union') {
      const idx = r.readUInt(bitsForOptions(field.discriminator.options));
      const key = field.discriminator.options[idx];
      const obj: any = { [field.discriminator.name]: key };
      field.variants[key].forEach(
        (f) => (obj[f.name] = decodeFieldWithLogging(r, f, optionalLogAttributes, depth + 1))
      );
      result = obj;
    } else if (field.type === 'optional') {
      result = Boolean(r.readUInt(1))
        ? decodeFieldWithLogging(r, field.field, optionalLogAttributes, depth + 1)
        : field.defaultValue !== undefined
        ? field.defaultValue
        : null;
    } else if (field.type === 'object') {
      result = Object.fromEntries(
        field.fields.map((f) => [f.name, decodeFieldWithLogging(r, f, optionalLogAttributes, depth + 1)])
      );
    } else {
      // For all simple types (bool, int, enum, fixed, enum_array), use original codec
      result = originalDecodeField(r, field);
    }

    if (shouldLog) {
      console.log(`${indent}✓ Decoded field "${field.name}":`, result);
    }

    return result;
  } catch (error) {
    console.error(`${indent}✗ Error decoding field "${field.name}" (${field.type}):`, error);
    throw error;
  }
}

/**
 * Debug wrapper for encoding with error handling and logging
 */
export const encodeDebugWrapper = (
  schema: DenseSchema,
  data: any,
  ...optionalLogAttributes: string[]
): string | null => {
  try {
    const w = new BitWriter();

    for (const f of schema.fields) {
      encodeFieldWithLogging(w, f, data[f.name], optionalLogAttributes, 0);
    }

    return w.getFromBase();
  } catch (error) {
    console.error('Encoding failed:');
    console.error(error);
    return null;
  }
};

/**
 * Debug wrapper for decoding with error handling and logging
 */
export const decodeDebugWrapper = (
  schema: DenseSchema,
  base64: string,
  ...optionalLogAttributes: string[]
): any | null => {
  try {
    const r = BitReader.getFromBase(base64, 'base64url');
    const obj: any = {};

    for (const f of schema.fields) {
      obj[f.name] = decodeFieldWithLogging(r, f, optionalLogAttributes, 0);
    }

    return obj;
  } catch (error) {
    console.error('Decoding failed:');
    console.error(error);
    return null;
  }
};
