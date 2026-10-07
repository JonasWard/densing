import { DenseField, DenseSchema, EnumField, FieldTypes } from '../schema-type';
import { resolveFieldByName } from '../densing';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, union } from './builder';

type JsonObject = Record<string, unknown>;

const allowedKeys: Record<DenseField['type'], readonly string[]> = {
  bool: ['type', 'name', 'defaultValue'],
  int: ['type', 'name', 'min', 'max', 'defaultValue'],
  enum: ['type', 'name', 'options', 'defaultValue'],
  fixed: ['type', 'name', 'min', 'max', 'precision', 'defaultValue'],
  array: ['type', 'name', 'minLength', 'maxLength', 'items'],
  enum_array: ['type', 'name', 'enum', 'minLength', 'maxLength', 'defaultValue'],
  union: ['type', 'name', 'discriminator', 'variants'],
  optional: ['type', 'name', 'field', 'defaultValue'],
  object: ['type', 'name', 'fields'],
  pointer: ['type', 'name', 'targetName']
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (path: string, message: string): never => {
  throw new Error(`Invalid schema at ${path}: ${message}`);
};

const requireNumber = (json: JsonObject, key: string, path: string): number => {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, `"${key}" must be a finite number`);
  return value as number;
};

const optionalNumber = (json: JsonObject, key: string, path: string): number | undefined =>
  json[key] === undefined || json[key] === null ? undefined : requireNumber(json, key, path);

const requireString = (json: JsonObject, key: string, path: string): string => {
  const value = json[key];
  if (typeof value !== 'string') fail(path, `"${key}" must be a string`);
  return value as string;
};

const requireStringArray = (json: JsonObject, key: string, path: string): string[] => {
  const value = json[key];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
    fail(path, `"${key}" must be an array of strings`);
  return value as string[];
};

const fieldFromJson = (json: unknown, path: string): DenseField => {
  if (!isObject(json)) return fail(path, 'field must be an object');

  const type = json.type;
  if (typeof type !== 'string' || !(FieldTypes as readonly string[]).includes(type))
    return fail(path, `"type" must be one of [${FieldTypes.join(', ')}], got ${JSON.stringify(type)}`);

  const fieldType = type as DenseField['type'];
  const name = requireString(json, 'name', path);
  const unknownKeys = Object.keys(json).filter((key) => !allowedKeys[fieldType].includes(key));
  if (unknownKeys.length) fail(path, `unknown propert${unknownKeys.length > 1 ? 'ies' : 'y'} ${unknownKeys.join(', ')}`);

  try {
    switch (fieldType) {
      case 'bool': {
        const defaultValue = json.defaultValue ?? undefined;
        if (defaultValue !== undefined && typeof defaultValue !== 'boolean') fail(path, '"defaultValue" must be a boolean');
        return bool(name, defaultValue as boolean | undefined);
      }
      case 'int':
        return int(
          name,
          requireNumber(json, 'min', path),
          requireNumber(json, 'max', path),
          optionalNumber(json, 'defaultValue', path)
        );
      case 'fixed':
        return fixed(
          name,
          requireNumber(json, 'min', path),
          requireNumber(json, 'max', path),
          requireNumber(json, 'precision', path),
          optionalNumber(json, 'defaultValue', path)
        );
      case 'enum': {
        const defaultValue = json.defaultValue ?? undefined;
        if (defaultValue !== undefined && typeof defaultValue !== 'string') fail(path, '"defaultValue" must be a string');
        return enumeration(name, requireStringArray(json, 'options', path), defaultValue as string | undefined);
      }
      case 'array':
        return array(
          name,
          requireNumber(json, 'minLength', path),
          requireNumber(json, 'maxLength', path),
          fieldFromJson(json.items, `${path}.items`)
        );
      case 'enum_array': {
        const enumField = enumFromJson(json.enum, `${path}.enum`);
        const defaultValue =
          json.defaultValue === undefined || json.defaultValue === null
            ? undefined
            : requireStringArray(json, 'defaultValue', path);
        return enumArray(
          name,
          enumField,
          requireNumber(json, 'minLength', path),
          requireNumber(json, 'maxLength', path),
          defaultValue
        );
      }
      case 'union': {
        const discriminator = enumFromJson(json.discriminator, `${path}.discriminator`);
        if (!isObject(json.variants)) return fail(path, '"variants" must be an object');
        const variants = Object.fromEntries(
          Object.entries(json.variants).map(([key, fields]) => [
            key,
            fieldsFromJson(fields, `${path}.variants.${key}`)
          ])
        );
        return union(name, discriminator, variants);
      }
      case 'optional':
        return optional(name, fieldFromJson(json.field, `${path}.field`), json.defaultValue);
      case 'object':
        return object(name, ...fieldsFromJson(json.fields, `${path}.fields`));
      case 'pointer':
        return pointer(name, requireString(json, 'targetName', path));
    }
  } catch (error) {
    // builder errors don't know where they are in the schema, re-throw them with the path
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Invalid schema at ')) throw error;
    return fail(path, message);
  }
};

const enumFromJson = (json: unknown, path: string): EnumField => {
  const field = fieldFromJson(json, path);
  if (field.type !== 'enum') return fail(path, `expected an enum field, got "${field.type}"`);
  return field;
};

const fieldsFromJson = (json: unknown, path: string): DenseField[] => {
  if (!Array.isArray(json)) return fail(path, 'must be an array of fields');
  return json.map((field, i) => fieldFromJson(field, `${path}[${i}]`));
};

const checkPointers = (schema: DenseSchema, fields: DenseField[], path: string): void =>
  fields.forEach((field, i) => {
    const fieldPath = `${path}[${i}]`;
    switch (field.type) {
      case 'pointer':
        if (!resolveFieldByName(schema, field.targetName))
          fail(fieldPath, `pointer "${field.name}" references unknown field "${field.targetName}"`);
        break;
      case 'array':
        checkPointers(schema, [field.items], `${fieldPath}.items`);
        break;
      case 'optional':
        checkPointers(schema, [field.field], `${fieldPath}.field`);
        break;
      case 'object':
        checkPointers(schema, field.fields, `${fieldPath}.fields`);
        break;
      case 'union':
        Object.entries(field.variants).forEach(([key, variantFields]) =>
          checkPointers(schema, variantFields, `${fieldPath}.variants.${key}`)
        );
        break;
    }
  });

/**
 * Load a schema from its JSON representation (e.g. the output of `JSON.stringify(schema)`)
 * Every field is rebuilt with the builder helpers, so the same validation applies and missing defaults are filled in
 * @param input - the schema as JSON string or already parsed object
 * @returns `DenseSchema` - the validated schema
 * @throws if the input is not a valid schema, the message contains the path of the offending field
 */
export const schemaFromJson = (input: unknown): DenseSchema => {
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch (error) {
      throw new Error(`Invalid schema: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (!isObject(json)) return fail('root', 'schema must be an object with a "fields" array');
  const unknownKeys = Object.keys(json).filter((key) => key !== 'fields');
  if (unknownKeys.length) fail('root', `unknown propert${unknownKeys.length > 1 ? 'ies' : 'y'} ${unknownKeys.join(', ')}`);

  const schema: DenseSchema = { fields: fieldsFromJson(json.fields, 'fields') };
  checkPointers(schema, schema.fields, 'fields');
  return schema;
};
