// The public API. Everything not exported here is internal and may change in any release.

// Schema definition
export { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, schema, union } from './schema/builder';
export type {
  ArrayField,
  BoolField,
  ConstantBitWidthField,
  DenseField,
  DenseSchema,
  EnumArrayField,
  EnumField,
  FixedPointField,
  IntField,
  ObjectField,
  OptionalField,
  PointerField,
  UnionField
} from './schema-type';
export { FieldTypes } from './schema-type';
export { domain, domains } from './schema/domains';
export type { DomainsOptions, NumericDomain } from './schema/domains';

// Encoding and decoding
export { densing, undensing } from './densing';
export { DenseDecodeError, DenseEncodeError } from './errors';
export { MAX_FIELD_BITS, PRECISION_ALIGNMENT_TOLERANCE } from './values';

// Validation and defaults
export { validate, validateField } from './schema/validation';
export type { ValidationError, ValidationResult } from './schema/validation';
export { validateSchema } from './schema/validate-schema';
export { getDefaultData } from './schema/default-data';
export { generateTypes, printTypes } from './schema/type-generator';

// Size analysis and introspection
export {
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  calculateDenseFieldBitWidth,
  getAllDenseSchemaPaths,
  getDenseFieldBitWidthRange,
  getFieldByPath,
  walkDenseSchema
} from './api';
export type { DataSizeInfo, SchemaSizeInfo } from './api';

// Alphabets
export { BaseTypes, base64url, baseQRCode45UrlSafe, binary, customBase } from './encoding/alphabets';
export type { BaseSpec, BaseType, CustomBase } from './encoding/alphabets';
export {
  getBase64FromBigInt,
  getBigIntFromBase64,
  getBigIntFrombaseQRCode45UrlSafe,
  getbaseQRCode45UrlSafeFromBigInt
} from './encoding/radix';
