import { DenseSchema, DenseField } from '../schema-type';

/**
 * Generate TypeScript type definitions from a schema
 */
export const generateTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): string => {
  const types: string[] = [];
  const processedTypes = new Set<string>();

  // Generate the root type
  const rootFields = schema.fields
    .map((field) => {
      const fieldType = getFieldType(field, types, processedTypes);
      return `  ${field.name}: ${fieldType};`;
    })
    .join('\n');

  const rootType = `export interface ${rootTypeName} {\n${rootFields}\n}`;

  // Return all generated types with the root type at the end
  return [...types, rootType].join('\n\n');
};

/**
 * Get the TypeScript type for a field
 */
const getFieldType = (field: DenseField, types: string[], processedTypes: Set<string>): string => {
  switch (field.type) {
    case 'bool':
      return 'boolean';

    case 'int':
    case 'fixed':
      return 'number';

    case 'enum':
      return field.options.map((opt) => `'${opt}'`).join(' | ');

    case 'enum_array':
      return `(${field.enum.options.map((opt) => `'${opt}'`).join(' | ')})[]`;

    case 'array': {
      const itemType = getFieldType(field.items, types, processedTypes);
      return `${itemType}[]`;
    }

    case 'optional': {
      const innerType = getFieldType(field.field, types, processedTypes);
      return `${innerType} | null`;
    }

    case 'object': {
      const typeName = capitalize(field.name);

      if (!processedTypes.has(typeName)) {
        processedTypes.add(typeName);
        const objectFields = field.fields
          .map((f) => {
            const fieldType = getFieldType(f, types, processedTypes);
            return `  ${f.name}: ${fieldType};`;
          })
          .join('\n');

        types.push(`export interface ${typeName} {\n${objectFields}\n}`);
      }

      return typeName;
    }

    case 'pointer': {
      // For pointers, generate a type based on the target field name
      // This creates a self-referential type for recursive structures
      const targetTypeName = capitalize(field.targetName);
      return targetTypeName;
    }

    case 'union': {
      const typeName = capitalize(field.name);

      if (!processedTypes.has(typeName)) {
        processedTypes.add(typeName);

        // Get discriminator options (now always strings)
        const options = field.discriminator.options;

        // Generate variant types
        const variants = options.map((option) => {
          const variantTypeName = `${typeName}_${capitalize(option)}`;
          const variantFields = field.variants[option] || [];

          const fields = [
            `  ${field.discriminator.name}: '${option}';`,
            ...variantFields.map((f) => {
              const fieldType = getFieldType(f, types, processedTypes);
              return `  ${f.name}: ${fieldType};`;
            })
          ].join('\n');

          types.push(`export interface ${variantTypeName} {\n${fields}\n}`);

          return variantTypeName;
        });

        // Generate union type
        types.push(`export type ${typeName} = ${variants.join(' | ')};`);
      }

      return typeName;
    }

    default:
      return 'unknown';
  }
};

/**
 * Capitalize the first letter of a string
 */
const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Generate types and write to console (for convenience)
 */
export const printTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): void => {
  console.log(generateTypes(schema, rootTypeName));
};
