// codec.ts
import { BitWriter, BitReader, BaseType } from './helpers';
import { DenseSchema, DenseField, ConstantBitWidthField } from './schema-type';

// bit-width helper methods
export const bitsForRange = (range: number) => (range <= 1 ? 0 : Math.ceil(Math.log2(range)));
const scaleForPrecision = (precision: number) => Math.round(1 / precision);
const bitsForInt = (min: number, max: number) => bitsForRange(Math.round(max - min) + 1);
const bitsForFixed = (min: number, max: number, precision: number) =>
  bitsForRange(Math.round((max - min) * scaleForPrecision(precision)) + 1);

// to uInt helper methods
const uIntForRange = (value: number) => Math.round(value);
const uIntForInt = (value: number, min: number) => uIntForRange(value - min);
const uIntForFixed = (value: number, min: number, precision: number) =>
  uIntForRange((value - min) * scaleForPrecision(precision));

// from uInt helper methods
const rangeFromUInt = (uInt: number) => uInt;
const intFromUint = (uInt: number, min: number) => uIntForRange(uInt) + min;
const fixedFromUint = (uInt: number, min: number, precision: number) => uIntForRange(uInt) * precision + min;

// array length helpers
export const bitsForMinMaxLength = (minLength: number, maxLength: number) => bitsForRange(maxLength - minLength + 1);
const uIntForMinMaxLength = (value: number, minLength: number) => value - minLength;
export const lengthForUIntMinMaxLength = (uInt: number, minLength: number) => uInt + minLength;
const bitsForEnumArrayContent = (length: number, base: number) =>
  length < 1 ? 0 : Math.ceil(length * Math.log2(base));

// options helper methods
export const bitsForOptions = (options: readonly string[]) => bitsForRange(options.length);
const sizeForOptions = (options: readonly string[]) => options.length;

/**
 * Densing method - key method to dense (pack into encoded string) the data for a given schema into a string of a specific base
 * @param denseSchema - The schema to dense the data for
 * @param data - The data to dense
 * @param base - The base as string of characters, where every symbol is interpreted as a specific value
 * @returns The dense string in the given base
 */
export const densing = (denseSchema: DenseSchema, data: any, base: BaseType | string = 'base64url'): string => {
  const w = new BitWriter();
  denseSchema.fields.forEach((f) => densingField(w, f, data[f.name]));
  return w.getFromBase(base);
};

export const getUIntForConstantBitWidthField = (field: ConstantBitWidthField, value: any): number => {
  switch (field.type) {
    case 'bool':
      return value ? 1 : 0;
    case 'int':
      return uIntForInt(value, field.min);
    case 'enum':
      return field.options.indexOf(value);
    case 'fixed':
      return uIntForFixed(value, field.min, field.precision);
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
  }
};

/**
 * Helper method to dense a single field of the schema into the given bit writer
 * @param w - The bit writer to write the dense data to
 * @param field - The field used as the template to dense the value with
 * @param value - The value to dense, should match the type of the field! This method doesn't do any validation of data!
 */
export function densingField(w: BitWriter, field: DenseField, value: any): void {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed':
      w.writeUInt(getUIntForConstantBitWidthField(field, value), getBitWidthForContantBitWidthFields(field));
      break;
    case 'array': {
      if (!Array.isArray(value)) throw new Error('value of `array` is not an array');
      const arrayLengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (arrayLengthBits !== 0)
        w.writeUInt(uIntForMinMaxLength((value as any[]).length, field.minLength), arrayLengthBits);
      (value as any[]).forEach((v) => densingField(w, field.items, v));
      break;
    }

    case 'union': {
      const discValue = value[field.discriminator.name];
      const discIdx = field.discriminator.options.indexOf(discValue);
      if (discIdx === -1) throw new Error(`Invalid union discriminator value: ${discValue}`);
      w.writeUInt(discIdx, bitsForOptions(field.discriminator.options));
      field.variants[discValue].forEach((f) => densingField(w, f, value[f.name]));
      break;
    }

    case 'enum_array': {
      if (!Array.isArray(value)) throw new Error('value of `enum_array` is not an array');
      const arrayLengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (arrayLengthBits !== 0)
        w.writeUInt(uIntForMinMaxLength((value as string[]).length, field.minLength), arrayLengthBits);

      const base = BigInt(sizeForOptions(field.enum.options));

      const result = (value as string[]).reduce((acc, c) => {
        const idx = field.enum.options.indexOf(c);
        if (idx === -1) throw new Error(`Invalid enum value in array: ${c}`);
        return acc * base + BigInt(idx);
      }, 0n);
      const contentBits = bitsForEnumArrayContent(value.length, sizeForOptions(field.enum.options));
      w.writeUInt(result, contentBits);
      break;
    }

    case 'optional': {
      const isPresent = value !== undefined && value !== null;
      w.writeUInt(isPresent ? 1 : 0, 1);
      if (isPresent) {
        densingField(w, field.field, value);
      }
      break;
    }

    case 'object': {
      if (typeof value !== 'object' || value === null) throw new Error('value of `object` is not an object');
      field.fields.forEach((f) => densingField(w, f, value[f.name]));
      break;
    }
  }
}

/**
 * Undensing method - key method to undense (unpack from encoded string) the data for a given schema from a string of a specific base
 * @param denseSchema - The schema to undense the data for
 * @param baseString - The dense string to undense
 * @param base - The base as string of characters, where every symbol is interpreted as a specific value
 * @returns The undense data
 */
export function undensing(denseSchema: DenseSchema, baseString: string, base: BaseType | string = 'base64url'): any {
  const r = BitReader.getFromBase(baseString, base);
  const obj: any = {};
  denseSchema.fields.forEach((f) => (obj[f.name] = undensingField(r, f)));
  return obj;
}

export const undensingDataForConstantBitWidthField = (field: ConstantBitWidthField, unsignedInt: number): any => {
  switch (field.type) {
    case 'bool':
      return Boolean(unsignedInt);
    case 'int':
      return intFromUint(unsignedInt, field.min);
    case 'enum':
      return field.options[unsignedInt];
    case 'fixed':
      return fixedFromUint(unsignedInt, field.min, field.precision);
  }
};

/**
 * Internal Helper method to undense a single field of the schema from the given bit reader
 * @param r - The bit reader to read the dense data from
 * @param denseField - The field used as the template to undense the value with
 * @returns The undense value, should match the type of the field! This method doesn't do any validation of data!
 */
export function undensingField(r: BitReader, denseField: DenseField): any {
  switch (denseField.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed':
      return undensingDataForConstantBitWidthField(
        denseField,
        r.readUInt(getBitWidthForContantBitWidthFields(denseField))
      );

    case 'array': {
      const length = lengthForUIntMinMaxLength(
        r.readUInt(bitsForMinMaxLength(denseField.minLength, denseField.maxLength)),
        denseField.minLength
      );
      return Array.from({ length }, () => undensingField(r, denseField.items));
    }

    case 'union': {
      const idx = r.readUInt(bitsForOptions(denseField.discriminator.options));
      const key = denseField.discriminator.options[idx];
      const obj: any = { [denseField.discriminator.name]: key };
      denseField.variants[key].forEach((f) => (obj[f.name] = undensingField(r, f)));
      return obj;
    }

    case 'enum_array':
      const base = BigInt(sizeForOptions(denseField.enum.options));
      const arrayLengthBits = bitsForMinMaxLength(denseField.minLength, denseField.maxLength);
      const length = lengthForUIntMinMaxLength(r.readUInt(arrayLengthBits), denseField.minLength);
      const contentBits = bitsForEnumArrayContent(length, sizeForOptions(denseField.enum.options));

      let bigIntValue = r.readUBigInt(contentBits);
      const result: string[] = [];

      for (let i = 0; i < length; i++) {
        // always use BigInt modulo and division
        const idx = Number(bigIntValue % base); // convert index to number for enum lookup
        result.unshift(denseField.enum.options[idx]); // unshift to reverse the order (most significant digit first)
        bigIntValue = bigIntValue / base;
      }

      return result;

    case 'optional':
      return Boolean(r.readUInt(1))
        ? undensingField(r, denseField.field)
        : denseField.defaultValue !== undefined
        ? denseField.defaultValue
        : null;

    case 'object':
      return Object.fromEntries(denseField.fields.map((f) => [f.name, undensingField(r, f)]));
  }
}
