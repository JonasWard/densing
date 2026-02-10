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
  | PointerField;

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

export interface DenseSchema {
  fields: DenseField[];
}

export type ConstantBitWidthField = BoolField | IntField | EnumField | FixedPointField;