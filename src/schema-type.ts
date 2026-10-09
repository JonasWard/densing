// schema.ts
export type DenseField =
  | BoolField
  | IntField
  | EnumField
  | FixedPointField
  | ArrayField
  | EnumArrayField
  | UnionField
  | OptionalField
  | ObjectField
  | PointerField
  | ReferenceNumericField
  | ReferenceField;

export interface BoolField {
  type: 'bool';
  name: string;
  defaultValue: boolean;
}

export interface IntField {
  type: 'int';
  name: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface EnumField {
  type: 'enum';
  name: string;
  options: readonly string[];
  defaultValue: string;
}

export interface FixedPointField {
  type: 'fixed';
  name: string;
  min: number;
  max: number;
  precision: number;
  defaultValue: number;
}

export interface ArrayField {
  type: 'array';
  name: string;
  items: DenseField;
  minLength: number;
  maxLength: number;
}

export interface UnionField {
  type: 'union';
  name: string;
  discriminator: EnumField;
  variants: Record<string, DenseField[]>;
}

export interface EnumArrayField {
  type: 'enum_array';
  name: string;
  enum: EnumField;
  minLength: number;
  maxLength: number;
  defaultValue: string[];
}

export interface OptionalField {
  type: 'optional';
  name: string;
  field: DenseField;
  defaultValue?: any;
}

export interface ObjectField {
  type: 'object';
  name: string;
  fields: DenseField[];
}

export interface PointerField {
  type: 'pointer';
  name: string;
  targetName: string;
}

/**
 * A number whose range and precision come from a schema-level `NumericDefinition`. Which of the
 * definition's presets applies is stored once per payload (`$presets` in the data).
 */
export interface ReferenceNumericField {
  type: 'reference_numeric';
  name: string;
  /** name of the `NumericDefinition` */
  ref: string;
}

/**
 * A value shaped like one of the schema's `templates`. Templates are only ever used through a
 * reference: they are not values themselves and never appear in the data.
 */
export interface ReferenceField {
  type: 'reference';
  name: string;
  /** index into `DenseSchema.templates` */
  ref: number;
}

/** One preset of a `NumericDefinition`: an `int` without `precision`, a `fixed` with it */
export interface NumericPreset {
  min: number;
  max: number;
  precision?: number;
  defaultValue?: number;
}

/**
 * A numeric definition shared by `reference_numeric` fields. Every payload selects one of its presets
 * (in the header, `bits(presets)` bits), and all fields referencing it are encoded with that preset.
 */
export interface NumericDefinition {
  name: string;
  /** in preset order: the order of the indices stored in the header */
  presets: Record<string, NumericPreset>;
  /** preset used when the data does not select one; the first preset when not set */
  defaultPreset?: string;
}

export interface DenseSchema {
  definitions?: NumericDefinition[];
  /** reference-only shapes, used through `reference` fields (`ref` is the index) */
  templates?: DenseField[];
  fields: DenseField[];
}

export type ConstantBitWidthField = BoolField | IntField | EnumField | FixedPointField;
export const FieldTypes = [
  'bool',
  'int',
  'enum',
  'fixed',
  'array',
  'enum_array',
  'union',
  'optional',
  'object',
  'pointer',
  'reference_numeric',
  'reference'
] as const;

/**
 * Exhaustiveness guard for switches over `DenseField['type']`.
 * Call it from the `default` arm: adding a field type then becomes a compile error at every switch
 * that does not handle it, and a malformed schema throws instead of being silently skipped.
 */
export const assertNeverDenseField = (field: never): never => {
  throw new Error(`Unknown field type "${(field as { type?: unknown })?.type}"`);
};
