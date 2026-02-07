import {
  BoolField,
  IntField,
  EnumField,
  FixedPointField,
  DenseField,
  ArrayField,
  UnionField,
  EnumArrayField,
  OptionalField,
  ObjectField
} from '../schema-type';

/* =========================
 * Primitive Field Helpers
 * ========================= */

export const bool = (name: string, defaultValue: boolean = false): BoolField => ({
  type: 'bool',
  name,
  defaultValue
});

export const int = (name: string, min: number, max: number, defaultValue?: number): IntField => {
  if (max < min) throw new Error(`int "${name}": max < min`);
  return { type: 'int', name, min, max, defaultValue: defaultValue ?? min };
};

export const enumeration = (name: string, options: readonly string[], defaultValue?: string): EnumField => {
  if (options.length < 2) throw new Error(`enum "${name}": must have at least 2 values`);
  if (new Set(options).size !== options.length) throw new Error(`enum "${name}": duplicate values`);
  return { type: 'enum', name, options, defaultValue: defaultValue ?? options[0] };
};

export const fixed = (
  name: string,
  min: number,
  max: number,
  precision: number,
  defaultValue?: number
): FixedPointField => {
  if (precision <= 0) {
    throw new Error(`fixed "${name}": precision must be > 0`);
  }
  const scale = 1 / precision;
  if (!Number.isInteger(scale)) {
    throw new Error(`fixed "${name}": 1 / precision must be an integer`);
  }
  if (max < min) {
    throw new Error(`fixed "${name}": max < min`);
  }
  return { type: 'fixed', name, min, max, precision, defaultValue: defaultValue ?? min };
};

const minMaxValidation = (type: string, name: string, minLength: number, maxLength: number) => {
  if (!Number.isInteger(minLength) || minLength < 0)
    throw new Error(`fixedArray ${type} "${name}": minLength (${minLength}) must be a positive integer`);
  if (!Number.isInteger(maxLength) || maxLength <= 0)
    throw new Error(`fixedArray ${type} "${name}": maxLength (${maxLength}) must be a positive integer`);
  if (maxLength < minLength)
    throw new Error(
      `fixedArray ${type} "${name}": maxLength (${maxLength}) must be larger than minLength (${minLength})`
    );
};

/* =========================
 * Array Helpers
 * ========================= */
export const array = (name: string, minLength: number, maxLength: number, items: DenseField): ArrayField => {
  minMaxValidation('array', name, minLength, maxLength);

  return {
    type: 'array',
    name,
    minLength,
    maxLength,
    items
  };
};

/* =========================
 * Union Helpers
 * ========================= */

const discriminatorValidation = (name: string, discriminator: EnumField, variants: Record<string, DenseField[]>) => {
  for (const value of discriminator.options)
    if (!variants[value]) throw new Error(`union "${name}": missing variant definition for "${value}"`);
};

export const union = (name: string, discriminator: EnumField, variants: Record<string, DenseField[]>): UnionField => {
  discriminatorValidation(name, discriminator, variants);

  return {
    type: 'union',
    name,
    discriminator,
    variants
  };
};

/* =========================
 * Enum Array Helpers
 * ========================= */

export const enumArray = (
  name: string,
  enumDef: EnumField,
  minLength: number,
  maxLength: number,
  defaultValue?: string[]
): EnumArrayField => {
  minMaxValidation('enum_array', name, minLength, maxLength);

  return {
    type: 'enum_array',
    name,
    enum: enumDef,
    minLength,
    maxLength,
    defaultValue: defaultValue ?? []
  };
};

/* =========================
 * Optional Field Helpers
 * ========================= */

export const optional = (name: string, field: DenseField, defaultValue?: any): OptionalField => {
  return {
    type: 'optional',
    name,
    field,
    defaultValue
  };
};

/* =========================
 * Object Field Helpers
 * ========================= */

export const object = (name: string, ...fields: DenseField[]): ObjectField => {
  return {
    type: 'object',
    name,
    fields
  };
};

/* =========================
 * Schema Root Helper
 * ========================= */

export const schema = <const T extends DenseField[]>(...fields: T): { readonly fields: T } =>
  ({
    fields
  } as const);
