import { DenseSchema, DenseField } from '../schema-type';

/**
 * Helper method to get the default state as defined by a schema
 * @param schema - `Schema` definition
 * @returns `Object` - A javascript object with the default state described in the schema
 */
export const getDefaultData = (schema: DenseSchema): any => {
  const result: any = {};
  schema.fields.forEach((field) => {
    result[field.name] = getDefaultValueForField(field);
  });
  return result;
};

/**
 * Helper method to get the default value for a field as defined by a schema
 * @note this method will recurse for some field types
 * @param field - `Field` definition
 * @param schema - Optional schema context for resolving pointers
 * @returns `any` - The default value for the field
 */
const getDefaultValueForField = (field: DenseField, schema?: DenseSchema): any => {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'enum':
    case 'fixed':
    case 'enum_array':
      return field.defaultValue;

    case 'optional':
      return field.defaultValue !== undefined ? field.defaultValue : null;

    case 'array':
      return Array.from({ length: field.minLength }, () => getDefaultValueForField(field.items, schema));

    case 'object':
      return Object.fromEntries(field.fields.map((f) => [f.name, getDefaultValueForField(f, schema)]));

    case 'union': {
      const defaultDiscriminatorValue = field.discriminator.defaultValue;

      const result: any = {
        [field.discriminator.name]: defaultDiscriminatorValue
      };

      // Add default values for the fields in the default variant
      const variantFields = field.variants[defaultDiscriminatorValue];
      if (variantFields) {
        variantFields.forEach((variantField) => {
          result[variantField.name] = getDefaultValueForField(variantField, schema);
        });
      }

      return result;
    }

    case 'pointer': {
      // For pointers, we can't generate default data without infinite recursion
      // Return null as a placeholder - user must provide actual data
      return null;
    }
  }
};
