import {
  BaseTypes,
  customBase,
  DenseDecodeError,
  DenseEncodeError,
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  densing,
  densingSchema,
  generateTypes,
  getAllDenseSchemaPaths,
  getDefaultData,
  pointersToTemplates,
  undensing,
  validate,
  type BaseSpec,
  type BaseType,
  type DenseSchema
} from 'densing';
import { CliError } from './io';

/**
 * Resolve the `--base` option: one of the named bases, otherwise a custom alphabet
 * (validated by `customBase`: at least 2 unique characters)
 */
export const resolveBase = (base: string): BaseSpec => {
  if (BaseTypes.includes(base as BaseType)) return base;
  try {
    return customBase(base);
  } catch (error) {
    throw new CliError(`invalid base: ${(error as Error).message}, use ${BaseTypes.join(', ')} or a custom alphabet`, 2);
  }
};

export const formatJson = (value: unknown, compact = false): string =>
  compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);

const assertValid = (schema: DenseSchema, data: unknown): void => {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new CliError('data must be a JSON object', 1);
  const result = validate(schema, data);
  if (!result.valid)
    throw new CliError(
      ['data does not match the schema:', ...result.errors.map((e) => `  ${e.path}: ${e.message}`)].join('\n'),
      1
    );
};

export const encodeCommand = (schema: DenseSchema, data: unknown, base: string): string => {
  const baseSpec = resolveBase(base);
  // validate first, to report every invalid field instead of only the first one `densing` throws on
  assertValid(schema, data);
  try {
    return densing(schema, data, baseSpec);
  } catch (error) {
    if (error instanceof DenseEncodeError) throw new CliError(`could not encode: ${error.message}`, 1);
    throw error;
  }
};

export const decodeCommand = (schema: DenseSchema, encoded: string, base: string, compact = false): string => {
  if (!encoded) throw new CliError('nothing to decode', 1);
  const baseSpec = resolveBase(base);
  try {
    return formatJson(undensing(schema, encoded, baseSpec), compact);
  } catch (error) {
    if (error instanceof DenseDecodeError) throw new CliError(`could not decode "${encoded}": ${error.message}`, 1);
    throw error;
  }
};

export const validateCommand = (schema: DenseSchema, data: unknown): string => {
  assertValid(schema, data);
  return 'valid';
};

export const sizeCommand = (schema: DenseSchema, data: unknown | undefined, compact = false): string => {
  if (data === undefined) return formatJson(analyzeDenseSchemaSize(schema), compact);
  assertValid(schema, data);
  return formatJson(calculateDenseDataSize(schema, data), compact);
};

export const defaultsCommand = (schema: DenseSchema, compact = false): string =>
  formatJson(getDefaultData(schema), compact);

export const typesCommand = (schema: DenseSchema, name = 'SchemaData'): string => generateTypes(schema, name);

export const pathsCommand = (schema: DenseSchema): string => getAllDenseSchemaPaths(schema).join('\n');

/** The schema with deprecated pointers turned into templates (same data, same payloads) */
export const upgradeCommand = (schema: DenseSchema, compact = false): string =>
  formatJson(pointersToTemplates(schema), compact);

/** The schema with all defaults filled in, as JSON, or with `dense` as the compact string of `densingSchema` */
export const schemaCommand = (schema: DenseSchema, compact = false, dense = false, base = 'base64url'): string =>
  dense ? densingSchema(schema, resolveBase(base)) : formatJson(schema, compact);
