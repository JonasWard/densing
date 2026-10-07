import {
  base64url,
  baseQRCode45UrlSafe,
  binary,
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  densing,
  generateTypes,
  getAllDenseSchemaPaths,
  getDefaultData,
  undensing,
  validate,
  type DenseSchema
} from 'densing';
import { CliError } from './io';

const namedBases: Record<string, string> = { base64url, baseQRCode45UrlSafe, binary };

/**
 * Resolve the `--base` option to its alphabet: one of the named bases, or a custom alphabet of unique characters
 */
export const resolveBase = (base: string): string => {
  const chars = namedBases[base] ?? base;
  if (chars.length < 2 || new Set(chars).size !== chars.length)
    throw new CliError(
      `invalid base "${base}": use ${Object.keys(namedBases).join(', ')} or at least 2 unique characters`,
      2
    );
  return chars;
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
  const chars = resolveBase(base);
  assertValid(schema, data);
  return densing(schema, data, chars);
};

export const decodeCommand = (schema: DenseSchema, encoded: string, base: string, compact = false): string => {
  if (!encoded) throw new CliError('nothing to decode', 1);
  const chars = resolveBase(base);
  const invalid = [...new Set(encoded)].filter((c) => !chars.includes(c));
  if (invalid.length) throw new CliError(`"${encoded}" contains characters outside of the base: ${invalid.join(' ')}`, 1);
  try {
    return formatJson(undensing(schema, encoded, chars), compact);
  } catch (error) {
    throw new CliError(`could not decode "${encoded}": ${(error as Error).message}`, 1);
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

export const schemaCommand = (schema: DenseSchema, compact = false): string => formatJson(schema, compact);
