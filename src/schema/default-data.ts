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
 * @returns `any` - The default value for the field
 */
const getDefaultValueForField = (field: DenseField): any => {
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
      return Array.from({ length: field.minLength }, () => getDefaultValueForField(field.items));

    case 'object':
      return Object.fromEntries(field.fields.map((f) => [f.name, getDefaultValueForField(f)]));

    case 'union': {
      const defaultDiscriminatorValue = field.discriminator.defaultValue;

      const result: any = {
        [field.discriminator.name]: defaultDiscriminatorValue
      };

      // Add default values for the fields in the default variant
      const variantFields = field.variants[defaultDiscriminatorValue];
      if (variantFields) {
        variantFields.forEach((variantField) => {
          result[variantField.name] = getDefaultValueForField(variantField);
        });
      }

      return result;
    }
  }
};
