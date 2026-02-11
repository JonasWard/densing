import { DenseField, DenseSchema, FieldTypes } from '@/schema-type';
import { bool, enumArray, enumeration, object, optional, union } from '../schema/builder';
import { walkDenseSchema } from '..';

/**
 * numeric values
 */

// prettier-ignore
const metaDenseNumberHardcodedContent = enumeration('metaDenseNumberHardcodedContent', ['0','1','2','3','4','5','6','7','8','9']);

// numbers are formatted as a special type
const metaDenseNumberHardcoded = enumArray('metaDenseNumberHardcoded', metaDenseNumberHardcodedContent, 1, 8, ['0']);
const metaDenseNumberExponentHardcoded = enumArray(
  'metaDenseNumberExponentHardcoded',
  metaDenseNumberHardcodedContent,
  1,
  4,
  ['0']
);

const metaNegative = bool('metaNegative', false);

const metaDenseInt = object('metaDenseInt', metaNegative, metaDenseNumberHardcoded);

const metaDenseFixed = object(
  'metaDenseNumber',
  metaNegative,
  metaDenseNumberHardcoded, // integer part
  optional('decimalPart', metaDenseNumberHardcoded, null),
  optional('exponentPart', object('exponentContent', metaNegative, metaDenseNumberExponentHardcoded), null)
);

const walkDenseSchemaField = (field: DenseField, namesAndOptions: Set<string>) => {
  // Always add the field name first
  namesAndOptions.add(field.name);

  // Then add type-specific names and recurse
  if (field.type === 'enum') {
    field.options.forEach((option) => namesAndOptions.add(option));
  } else if (field.type === 'enum_array') {
    namesAndOptions.add(field.enum.name);
    field.enum.options.forEach((option) => namesAndOptions.add(option));
  } else if (field.type === 'pointer') {
    namesAndOptions.add(field.targetName);
  } else if (field.type === 'object') {
    field.fields.forEach((f) => walkDenseSchemaField(f, namesAndOptions));
  } else if (field.type === 'array') {
    walkDenseSchemaField(field.items, namesAndOptions);
  } else if (field.type === 'optional') {
    walkDenseSchemaField(field.field, namesAndOptions);
  } else if (field.type === 'union') {
    walkDenseSchemaField(field.discriminator, namesAndOptions);
    Object.values(field.variants).forEach((variantFields) =>
      variantFields.forEach((f) => walkDenseSchemaField(f, namesAndOptions))
    );
  }

  return namesAndOptions;
};

export const getAllUniqueNamesAndOptions = (schema: DenseSchema): Set<string> => {
  const namesAndOptions = new Set<string>();
  walkDenseSchema(schema, (field) => walkDenseSchemaField(field, namesAndOptions));
  return namesAndOptions;
};

/**
 * object type attributes
 */
const metaObjectType = union('metaObjectType', enumeration('type', FieldTypes), {
  bool: [],
  int: [],
  enum: [],
  fixed: [],
  array: [],
  enum_array: [],
  union: [],
  optional: [],
  object: [],
  pointer: []
} as Record<DenseField['type'], DenseField[]>);

// ToDo for text
// collect all unique characters for: 'name' & 'options', store them as UTF-8 encoded string and store the length of its bitwidth
// for all 'name' & 'options', map them to the index of the character in the sorted string, store the length of its character count and store all the indexes in an enum array (options are the collected characters)
