// codec.ts
import { BitWriter, BitReader, BaseType } from './helpers';
import { DenseSchema, DenseField } from './schema-type';

// bit-width helper methods
const bitsForRange = (range: number) => (range <= 1 ? 0 : Math.ceil(Math.log2(range)));
const scaleForPrecision = (precision: number) => Math.round(1 / precision);
const bitsForInt = (min: number, max: number) => bitsForRange(Math.round(max - min));
const bitsForFixed = (min: number, max: number, precision: number) =>
  bitsForRange(Math.round((max - min) * scaleForPrecision(precision)));

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
const bitsForMinMaxLength = (minLength: number, maxLength: number) => bitsForRange(maxLength - minLength);
const uIntForMinMaxLength = (value: number, minLength: number) => value - minLength;
const lengthForUIntMinMaxLength = (uInt: number, minLength: number) => uInt + minLength;
const bitsForEnumArrayContent = (length: number, base: number) => bitsForRange(length * base);

// options helper methods
const bitsForOptions = (options: readonly string[]) => bitsForRange(options.length);
const sizeForOptions = (options: readonly string[]) => options.length;

export const undensing = (denseSchema: DenseSchema, data: any, base: BaseType | string = 'base64url'): string => {
  const w = new BitWriter();
  denseSchema.fields.forEach((f) => undensingField(w, f, data[f.name]));
  return w.getFromBase(base);
};

export function undensingField(w: BitWriter, field: DenseField, value: any): void {
  switch (field.type) {
    case 'bool':
      w.writeUInt(value ? 1 : 0, 1);
      break;

    case 'int': {
      w.writeUInt(uIntForInt(value, field.min), bitsForInt(field.min, field.max));
      break;
    }

    case 'enum': {
      const idx = field.options.indexOf(value);
      w.writeUInt(idx, bitsForOptions(field.options));
      break;
    }

    case 'fixed': {
      w.writeUInt(uIntForFixed(value, field.min, field.precision), bitsForFixed(field.min, field.max, field.precision));
      break;
    }

    case 'array': {
      if (!Array.isArray(value)) throw new Error('value of `array` is not an array');
      const arrayLengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (arrayLengthBits !== 0) w.writeUInt((value as any[]).length, arrayLengthBits);
      (value as any[]).forEach((v) => undensingField(w, field.items, v));
      break;
    }

    case 'union': {
      const discValue = value[field.discriminator.name];
      const discIdx = field.discriminator.options.indexOf(discValue);
      if (discIdx === -1) throw new Error(`Invalid union discriminator value: ${discValue}`);
      w.writeUInt(discIdx, bitsForOptions(field.discriminator.options));
      field.variants[discValue].forEach((f) => undensingField(w, f, value[f.name]));
      break;
    }

    case 'enum_array': {
      if (!Array.isArray(value)) throw new Error('value of `enum_array` is not an array');
      const arrayLengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (arrayLengthBits !== 0) w.writeUInt((value as string[]).length, arrayLengthBits);

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
        undensingField(w, field.field, value);
      }
      break;
    }

    case 'object': {
      if (typeof value !== 'object' || value === null) throw new Error('value of `object` is not an object');
      field.fields.forEach((f) => undensingField(w, f, value[f.name]));
      break;
    }
  }
}

export function densing(denseSchema: DenseSchema, baseString: string, base: BaseType | string = 'base64url'): any {
  const r = BitReader.getFromBase(baseString, base);
  const obj: any = {};
  denseSchema.fields.forEach((f) => (obj[f.name] = densingField(r, f)));
  return obj;
}

export function densingField(r: BitReader, denseField: DenseField): any {
  switch (denseField.type) {
    case 'bool':
      return Boolean(r.readUInt(1));

    case 'int':
      return intFromUint(r.readUInt(bitsForInt(denseField.min, denseField.max)), denseField.min);

    case 'enum':
      const idx = r.readUInt(bitsForOptions(denseField.options));
      return denseField.options[idx];

    case 'fixed':
      return fixedFromUint(
        r.readUInt(bitsForFixed(denseField.min, denseField.max, denseField.precision)),
        denseField.min,
        denseField.precision
      );

    case 'array': {
      const length = lengthForUIntMinMaxLength(
        r.readUInt(bitsForMinMaxLength(denseField.minLength, denseField.maxLength)),
        denseField.minLength
      );
      return Array.from({ length }, () => densingField(r, denseField.items));
    }

    case 'union': {
      const idx = r.readUInt(bitsForOptions(denseField.discriminator.options));
      const key = denseField.discriminator.options[idx];
      const obj: any = { [denseField.discriminator.name]: key };
      denseField.variants[key].forEach((f) => (obj[f.name] = densingField(r, f)));
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
        ? densingField(r, denseField.field)
        : denseField.defaultValue !== undefined
        ? denseField.defaultValue
        : null;

    case 'object':
      return Object.fromEntries(denseField.fields.map((f) => [f.name, densingField(r, f)]));
  }
}
