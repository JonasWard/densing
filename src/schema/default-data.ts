import { DenseSchema, DenseField, UnionField, assertNeverDenseField } from '../schema-type';
import { getDenseFieldBitWidthRange } from '../api';
import { resolvePointerOrThrow } from './resolve';

/**
 * Helper method to get the default state as defined by a schema
 * @param schema - `Schema` definition
 * @returns `Object` - A javascript object with the default state described in the schema. It always
 * passes `validate` and can be encoded, also for recursive schemas.
 */
export const getDefaultData = (schema: DenseSchema): any => {
  const result: any = {};
  schema.fields.forEach((field) => {
    result[field.name] = getDefaultValueForField(field, schema, new Set(), false);
  });
  return result;
};

/**
 * The union variant with the smallest encoding, preferring the discriminator's default on a tie.
 * Following it always terminates: every variant field is strictly smaller than the union itself.
 */
const smallestVariant = (field: UnionField, schema: DenseSchema): string => {
  const variantMin = (key: string) =>
    field.variants[key].reduce((sum, f) => sum + getDenseFieldBitWidthRange(f, schema).min, 0);
  return field.discriminator.options.reduce(
    (best, key) => (variantMin(key) < variantMin(best) ? key : best),
    field.discriminator.defaultValue
  );
};

/**
 * Helper method to get the default value for a field as defined by a schema
 * @note this method will recurse for some field types
 * @param field - `Field` definition
 * @param schema - Root schema, for resolving pointers
 * @param expanding - fields whose default is currently being built on this branch
 * @param minimal - build the smallest value instead of the defaults: used once a pointer leads back
 * into a field that is already being expanded, so that recursive schemas get a finite default
 * @returns `any` - The default value for the field
 */
const getDefaultValueForField = (
  field: DenseField,
  schema: DenseSchema,
  expanding: Set<DenseField>,
  minimal: boolean
): any => {
  const inner = new Set(expanding).add(field);
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed':
    case 'enum_array':
      return field.defaultValue;

    case 'optional':
      if (minimal || field.defaultValue === undefined) return null;
      return field.defaultValue;

    case 'array':
      return Array.from({ length: field.minLength }, () =>
        getDefaultValueForField(field.items, schema, inner, minimal)
      );

    case 'object':
      return Object.fromEntries(
        field.fields.map((f) => [f.name, getDefaultValueForField(f, schema, inner, minimal)])
      );

    case 'union': {
      const discriminatorValue = minimal ? smallestVariant(field, schema) : field.discriminator.defaultValue;
      const result: any = { [field.discriminator.name]: discriminatorValue };
      field.variants[discriminatorValue].forEach((variantField) => {
        result[variantField.name] = getDefaultValueForField(variantField, schema, inner, minimal);
      });
      return result;
    }

    case 'pointer': {
      const target = resolvePointerOrThrow(field, schema);
      return getDefaultValueForField(target, schema, inner, minimal || expanding.has(target));
    }

    default:
      return assertNeverDenseField(field);
  }
};
