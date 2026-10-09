// meta-schema.ts - the names and options used in a schema. Encoding a whole schema lives in schema-codec.ts.
import { DenseField, DenseSchema } from '@/schema-type';
import { walkDenseSchema } from '../api';

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
  } else if (field.type === 'reference_numeric') {
    namesAndOptions.add(field.ref);
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
  schema.templates?.forEach((template) => walkDenseSchemaField(template, namesAndOptions));
  schema.definitions?.forEach((definition) => {
    namesAndOptions.add(definition.name);
    Object.keys(definition.presets).forEach((preset) => namesAndOptions.add(preset));
  });
  walkDenseSchema(schema, (field) => walkDenseSchemaField(field, namesAndOptions));
  return namesAndOptions;
};
