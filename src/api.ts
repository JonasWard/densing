// api.ts - High-level API methods for schema introspection and size calculation
import {
  DenseSchema,
  DenseField,
  ConstantBitWidthField,
  BoolField,
  IntField,
  EnumField,
  FixedPointField,
  ArrayField,
  EnumArrayField,
  UnionField,
  OptionalField,
  ObjectField
} from './schema-type';
import { getBitWidthForContantBitWidthFields, bitsForMinMaxLength, bitsForOptions } from './densing';

/**
 * Calculate the bit width RANGE for a field (min and max possible bits)
 * Returns the minimum and maximum number of bits that can be used to encode this field
 */
export const getDenseFieldBitWidthRange = (field: DenseField): { min: number; max: number } => {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
      // Constant bit width fields always use the same number of bits
      const bits = getBitWidthForContantBitWidthFields(field);
      return { min: bits, max: bits };

    case 'optional': {
      // Optional fields: 1 bit for presence flag + field size if present
      const innerRange = getDenseFieldBitWidthRange(field.field);
      return {
        min: 1, // Just the presence bit when absent
        max: 1 + innerRange.max // Presence bit + full field when present
      };
    }

    case 'array': {
      // Array: length bits + content bits
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const itemRange = getDenseFieldBitWidthRange(field.items);
      return {
        min: lengthBits + field.minLength * itemRange.min,
        max: lengthBits + field.maxLength * itemRange.max
      };
    }

    case 'enum_array': {
      // Enum array: length bits + packed enum content
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const base = field.enum.options.length;
      const minContentBits = field.minLength === 0 ? 0 : Math.ceil(field.minLength * Math.log2(base));
      const maxContentBits = field.maxLength === 0 ? 0 : Math.ceil(field.maxLength * Math.log2(base));
      return {
        min: lengthBits + minContentBits,
        max: lengthBits + maxContentBits
      };
    }

    case 'object': {
      // Object: sum of all field ranges
      return field.fields.reduce(
        (acc, f) => {
          const range = getDenseFieldBitWidthRange(f);
          return { min: acc.min + range.min, max: acc.max + range.max };
        },
        { min: 0, max: 0 }
      );
    }

    case 'union': {
      // Union: discriminator bits + variant bits
      const discriminatorBits = bitsForOptions(field.discriminator.options);
      const variantRanges = Object.values(field.variants).map((fields) =>
        fields.reduce(
          (sum, f) => {
            const range = getDenseFieldBitWidthRange(f);
            return { min: sum.min + range.min, max: sum.max + range.max };
          },
          { min: 0, max: 0 }
        )
      );

      return {
        min: discriminatorBits + Math.min(...variantRanges.map((r) => r.min)),
        max: discriminatorBits + Math.max(...variantRanges.map((r) => r.max))
      };
    }

    default:
      return { min: 0, max: 0 };
  }
};

/**
 * Calculate the ACTUAL bit width for a field with a specific value
 * Returns the exact number of bits that will be used when encoding this value
 */
export const calculateDenseFieldBitWidth = (field: DenseField, value: any): number => {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
      return getBitWidthForContantBitWidthFields(field);

    case 'optional': {
      // 1 bit for presence + actual field size if present
      const isPresent = value !== null && value !== undefined;
      return 1 + (isPresent ? calculateDenseFieldBitWidth(field.field, value) : 0);
    }

    case 'array': {
      if (!Array.isArray(value)) return 0;
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const contentBits = value.reduce((sum, item) => sum + calculateDenseFieldBitWidth(field.items, item), 0);
      return lengthBits + contentBits;
    }

    case 'enum_array': {
      if (!Array.isArray(value)) return 0;
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const base = field.enum.options.length;
      const contentBits = value.length === 0 ? 0 : Math.ceil(value.length * Math.log2(base));
      return lengthBits + contentBits;
    }

    case 'object': {
      return field.fields.reduce((sum, f) => sum + calculateDenseFieldBitWidth(f, value?.[f.name]), 0);
    }

    case 'union': {
      const discriminatorBits = bitsForOptions(field.discriminator.options);
      const variantType = value?.[field.discriminator.name];
      if (!variantType) return discriminatorBits;

      const variantFields = field.variants[variantType] || [];
      const variantBits = variantFields.reduce((sum, f) => sum + calculateDenseFieldBitWidth(f, value), 0);
      return discriminatorBits + variantBits;
    }

    default:
      return 0;
  }
};

/**
 * Schema-level size information (static analysis without data)
 */
export interface SchemaSizeInfo {
  // Static analysis (without data)
  staticRange: {
    minBits: number;
    maxBits: number;
    minBytes: number;
    maxBytes: number;
    minBase64Chars: number;
    maxBase64Chars: number;
  };

  // Per-field static ranges
  fieldRanges: Record<string, { min: number; max: number }>;
}

/**
 * Analyze a schema to get static size information (min/max possible encoding sizes)
 */
export const analyzeDenseSchemaSize = (schema: DenseSchema): SchemaSizeInfo => {
  const fieldRanges: Record<string, { min: number; max: number }> = {};
  let totalMin = 0;
  let totalMax = 0;

  schema.fields.forEach((field) => {
    const range = getDenseFieldBitWidthRange(field);
    fieldRanges[field.name] = range;
    totalMin += range.min;
    totalMax += range.max;
  });

  return {
    staticRange: {
      minBits: totalMin,
      maxBits: totalMax,
      minBytes: Math.ceil(totalMin / 8),
      maxBytes: Math.ceil(totalMax / 8),
      minBase64Chars: Math.ceil(totalMin / 6),
      maxBase64Chars: Math.ceil(totalMax / 6)
    },
    fieldRanges
  };
};

/**
 * Data-specific size information (actual encoding size for given data)
 */
export interface DataSizeInfo {
  totalBits: number;
  totalBytes: number;
  base64Length: number;

  // Per-field actual sizes
  fieldSizes: Record<string, number>;

  // Efficiency metric
  efficiency: {
    usedBits: number;
    minPossibleBits: number;
    maxPossibleBits: number;
    utilizationPercent: number; // (used - min) / (max - min) * 100
  };
}

/**
 * Calculate the actual encoding size for specific data
 */
export const calculateDenseDataSize = (schema: DenseSchema, data: any): DataSizeInfo => {
  const schemaAnalysis = analyzeDenseSchemaSize(schema);
  const fieldSizes: Record<string, number> = {};
  let totalBits = 0;

  schema.fields.forEach((field) => {
    const bits = calculateDenseFieldBitWidth(field, data[field.name]);
    fieldSizes[field.name] = bits;
    totalBits += bits;
  });

  const minBits = schemaAnalysis.staticRange.minBits;
  const maxBits = schemaAnalysis.staticRange.maxBits;
  const utilizationPercent = maxBits === minBits ? 100 : ((totalBits - minBits) / (maxBits - minBits)) * 100;

  return {
    totalBits,
    totalBytes: Math.ceil(totalBits / 8),
    base64Length: Math.ceil(totalBits / 6),
    fieldSizes,
    efficiency: {
      usedBits: totalBits,
      minPossibleBits: minBits,
      maxPossibleBits: maxBits,
      utilizationPercent
    }
  };
};

/**
 * Get a field definition by path
 * @example getFieldByPath(schema, 'network.port') -> IntField
 */
export const getFieldByPath = (schema: DenseSchema, path: string): DenseField | null => {
  const parts = path.split('.');
  let current: DenseField | null = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const fields: DenseField[] | undefined = i === 0 ? schema.fields : (current as ObjectField)?.fields;
    if (!fields) return null;

    current = fields.find((f: DenseField) => f.name === part) || null;
    if (!current) return null;

    // Handle array items by wrapping in the items field
    if (current.type === 'array' && i < parts.length - 1) {
      current = current.items;
    }
  }

  return current;
};

/**
 * Walk all fields in schema (including nested)
 * @example walkDenseSchema(schema, (field, path) => console.log(path, field))
 */
export const walkDenseSchema = (
  schema: DenseSchema,
  callback: (field: DenseField, path: string, parent?: DenseField) => void,
  prefix = ''
): void => {
  schema.fields.forEach((field) => {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    callback(field, fieldPath);

    // Recurse into nested structures
    if (field.type === 'object') {
      walkDenseSchema({ fields: field.fields }, callback, fieldPath);
    } else if (field.type === 'array' && field.items.type === 'object') {
      walkDenseSchema({ fields: (field.items as ObjectField).fields }, callback, `${fieldPath}[]`);
    } else if (field.type === 'optional' && field.field.type === 'object') {
      walkDenseSchema({ fields: (field.field as ObjectField).fields }, callback, fieldPath);
    }
  });
};

/**
 * Get all paths in schema
 * @example getAllPaths(schema) -> ['deviceId', 'deviceType', 'network.ssid', 'network.port', ...]
 */
export const getAllDenseSchemaPaths = (schema: DenseSchema): string[] => {
  const paths: string[] = [];
  walkDenseSchema(schema, (field, path) => paths.push(path));
  return paths;
};
