// api.ts - High-level API methods for schema introspection and size calculation
import { DenseSchema, DenseField, UnionField, assertNeverDenseField } from './schema-type';
import {
  getBitWidthForContantBitWidthFields,
  bitsForEnumArrayContent,
  bitsForMinMaxLength,
  bitsForOptions
} from './densing';
import { discriminatorField, variantNames, variantObject, variantTemplate } from './schema/variants';
import {
  ActivePresets,
  PRESETS_KEY,
  allPresetFields,
  findDefinition,
  presetNames,
  resolveNumericOrThrow,
  resolveTemplateOrThrow,
  schemaDefinitions
} from './schema/definitions';

/** `count * bits`, where a count of 0 contributes nothing even when `bits` is unbounded */
const repeatBits = (count: number, bits: number): number => (count === 0 ? 0 : count * bits);

type Range = { min: number; max: number };

/** The range of a template, as reached through a reference or a union variant */
type TargetRange = (template: DenseField) => Range;

const sumRanges = (fields: DenseField[], schema: DenseSchema | undefined, targetRange: TargetRange) =>
  fields.reduce(
    (acc, f) => {
      const range = fieldBitWidthRange(f, schema, targetRange);
      return { min: acc.min + range.min, max: acc.max + range.max };
    },
    { min: 0, max: 0 }
  );

const fieldBitWidthRange = (field: DenseField, schema: DenseSchema | undefined, targetRange: TargetRange): Range => {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum': {
      // Constant bit width fields always use the same number of bits
      const bits = getBitWidthForContantBitWidthFields(field);
      return { min: bits, max: bits };
    }

    case 'reference_numeric': {
      // the width of the active preset: anything between the narrowest and the widest preset
      if (!schema) throw new Error(`reference_numeric field "${field.name}" requires schema context`);
      const definition = findDefinition(schema, field.ref);
      if (!definition) throw new Error(`reference_numeric field "${field.name}": definition "${field.ref}" does not exist`);
      const widths = allPresetFields(definition).map(getBitWidthForContantBitWidthFields);
      return { min: Math.min(...widths), max: Math.max(...widths) };
    }

    case 'optional': {
      // Optional fields: 1 bit for presence flag + field size if present
      const innerRange = fieldBitWidthRange(field.field, schema, targetRange);
      return {
        min: 1, // Just the presence bit when absent
        max: 1 + innerRange.max // Presence bit + full field when present
      };
    }

    case 'array': {
      // Array: length bits + content bits
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const itemRange = fieldBitWidthRange(field.items, schema, targetRange);
      return {
        min: lengthBits + repeatBits(field.minLength, itemRange.min),
        max: lengthBits + repeatBits(field.maxLength, itemRange.max)
      };
    }

    case 'enum_array': {
      // Enum array: length bits + packed enum content
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const base = field.enum.options.length;
      const minContentBits = bitsForEnumArrayContent(field.minLength, base);
      const maxContentBits = bitsForEnumArrayContent(field.maxLength, base);
      return {
        min: lengthBits + minContentBits,
        max: lengthBits + maxContentBits
      };
    }

    case 'object':
      // Object: sum of all field ranges
      return sumRanges(field.fields, schema, targetRange);

    case 'union': {
      // Union: discriminator bits + the smallest / largest variant
      const names = variantNames(field);
      const discriminatorBits = bitsForOptions(names);
      const variantRanges = names.map((key) => targetRange(variantTemplate(field, key, schema)));

      return {
        min: discriminatorBits + Math.min(...variantRanges.map((r) => r.min)),
        max: discriminatorBits + Math.max(...variantRanges.map((r) => r.max))
      };
    }

    case 'reference':
      return targetRange(resolveTemplateOrThrow(field, schema));

    default:
      return assertNeverDenseField(field);
  }
};

/**
 * Calculate the bit width RANGE for a field (min and max possible bits)
 * Returns the minimum and maximum number of bits that can be used to encode this field.
 * For recursive schemas `max` is `Infinity`: there is no static upper bound.
 * @param schema - the root schema, required to resolve templates and `reference_numeric` fields. The
 * ranges are cached per schema object: a schema must not be changed once it has been passed to densing
 */
export const getDenseFieldBitWidthRange = (field: DenseField, schema?: DenseSchema): { min: number; max: number } =>
  schemaRanges(schema)(field);

/**
 * `getDenseFieldBitWidthRange` for many fields of one schema. Each template is
 * measured once and shared; following every path through templates that refer to each other instead
 * takes exponential time.
 */
const bitWidthRanges = (schema?: DenseSchema): ((field: DenseField) => Range) => {
  // min: a smallest encoding never goes round a cycle. Every target starts at Infinity and is lowered
  // until nothing changes; a target that stays at Infinity has no finite value
  const minOf = new Map<DenseField, number>();
  let changed = false;
  const minEstimate: TargetRange = (target) => {
    if (!minOf.has(target)) {
      minOf.set(target, Infinity);
      changed = true;
    }
    return { min: minOf.get(target) ?? Infinity, max: 0 };
  };

  // max: a target that is reached again while it is being measured lies on a cycle, so the data can
  // nest without limit
  const maxOf = new Map<DenseField, number>();
  const expanding = new Set<DenseField>();
  const maxEstimate: TargetRange = (target) => ({ min: 0, max: targetMax(target) });
  const targetMax = (target: DenseField): number => {
    if (expanding.has(target)) return Infinity;
    if (!maxOf.has(target)) {
      expanding.add(target);
      maxOf.set(target, fieldBitWidthRange(target, schema, maxEstimate).max);
      expanding.delete(target);
    }
    return maxOf.get(target) ?? Infinity;
  };

  return (field) => {
    fieldBitWidthRange(field, schema, minEstimate); // finds the targets `field` refers to
    while (changed) {
      changed = false;
      // also visits the targets found during this loop
      for (const [target, min] of minOf) {
        const lower = fieldBitWidthRange(target, schema, minEstimate).min;
        if (lower < min) {
          minOf.set(target, lower);
          changed = true;
        }
      }
    }
    return fieldBitWidthRange(field, schema, (target) => ({ min: minOf.get(target) ?? Infinity, max: targetMax(target) }));
  };
};

/**
 * The bit width table of each schema, shared by every call. Schemas are treated as immutable once
 * they have been passed to densing.
 */
const rangesBySchema = new WeakMap<DenseSchema, (field: DenseField) => Range>();

export const schemaRanges = (schema?: DenseSchema): ((field: DenseField) => Range) => {
  if (!schema) return bitWidthRanges(undefined);
  let ranges = rangesBySchema.get(schema);
  if (!ranges) rangesBySchema.set(schema, (ranges = bitWidthRanges(schema)));
  return ranges;
};

/**
 * Calculate the ACTUAL bit width for a field with a specific value
 * Returns the exact number of bits that will be used when encoding this value
 * @param presets - the active preset per definition (the data's `$presets`), default presets when not given
 */
export const calculateDenseFieldBitWidth = (
  field: DenseField,
  value: any,
  schema?: DenseSchema,
  presets?: ActivePresets
): number => {
  switch (field.type) {
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
      return getBitWidthForContantBitWidthFields(field);

    case 'reference_numeric':
      return getBitWidthForContantBitWidthFields(resolveNumericOrThrow(field, schema, presets));

    case 'optional': {
      // 1 bit for presence + actual field size if present
      const isPresent = value !== null && value !== undefined;
      return 1 + (isPresent ? calculateDenseFieldBitWidth(field.field, value, schema, presets) : 0);
    }

    case 'array': {
      if (!Array.isArray(value)) return 0;
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const contentBits = value.reduce(
        (sum, item) => sum + calculateDenseFieldBitWidth(field.items, item, schema, presets),
        0
      );
      return lengthBits + contentBits;
    }

    case 'enum_array': {
      if (!Array.isArray(value)) return 0;
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const base = field.enum.options.length;
      const contentBits = bitsForEnumArrayContent(value.length, base);
      return lengthBits + contentBits;
    }

    case 'object': {
      return field.fields.reduce(
        (sum, f) => sum + calculateDenseFieldBitWidth(f, value?.[f.name], schema, presets),
        0
      );
    }

    case 'union': {
      const names = variantNames(field);
      const discriminatorBits = bitsForOptions(names);
      const variantType = value?.[field.discriminator];
      if (!names.includes(variantType)) return discriminatorBits;

      const variantFields = variantObject(field, variantType, schema).fields;
      const variantBits = variantFields.reduce(
        (sum, f) => sum + calculateDenseFieldBitWidth(f, value?.[f.name], schema, presets),
        0
      );
      return discriminatorBits + variantBits;
    }

    case 'reference':
      return calculateDenseFieldBitWidth(resolveTemplateOrThrow(field, schema), value, schema, presets);

    default:
      return assertNeverDenseField(field);
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

  // Per-field static ranges; `$presets` is the preset header of a schema with definitions
  fieldRanges: Record<string, { min: number; max: number }>;
}

/** Bits of the preset header: the preset index of every definition (0 for a schema without definitions) */
const presetHeaderBits = (schema: DenseSchema): number =>
  schemaDefinitions(schema).reduce((sum, definition) => sum + bitsForOptions(presetNames(definition)), 0);

/**
 * Analyze a schema to get static size information (min/max possible encoding sizes)
 */
export const analyzeDenseSchemaSize = (schema: DenseSchema): SchemaSizeInfo => {
  const fieldRanges: Record<string, { min: number; max: number }> = {};
  const headerBits = presetHeaderBits(schema);
  if (schemaDefinitions(schema).length) fieldRanges[PRESETS_KEY] = { min: headerBits, max: headerBits };
  let totalMin = headerBits;
  let totalMax = headerBits;

  const widths = schemaRanges(schema);
  schema.fields.forEach((field) => {
    const range = widths(field);
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

  // Per-field actual sizes; `$presets` is the preset header of a schema with definitions
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
  const headerBits = presetHeaderBits(schema);
  if (schemaDefinitions(schema).length) fieldSizes[PRESETS_KEY] = headerBits;
  let totalBits = headerBits;

  schema.fields.forEach((field) => {
    const bits = calculateDenseFieldBitWidth(field, data[field.name], schema, data[PRESETS_KEY]);
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

/*
 * Path grammar, shared by `getFieldByPath`, `walkDenseSchema` and `getAllDenseSchemaPaths`:
 *
 *   path    = segment ("." segment)*
 *   segment = field name, followed by "[]" when the field is an array and the path continues
 *             into its items
 *
 * Every nested field adds its own name as a segment:
 * - object      `settings.enabled`           (a field of the object)
 * - array       `users[].user`               (the items field; `[]` marks the step into the items)
 * - optional    `maybe.inner`                (the wrapped field)
 * - union       `action.type`, `action.delay` (the discriminator, or a field of any variant; when
 *                                            several variants declare the same name, the first
 *                                            variant in declaration order wins)
 * - reference   `expr.left.value`            (`getFieldByPath` continues in the template; the walk
 *                                            does not, since that may recurse forever)
 */

/** The fields of every variant, in declaration order (the walk and the paths list each one) */
const allVariantFields = (field: UnionField, schema: DenseSchema | undefined): DenseField[] =>
  variantNames(field).flatMap((key) => variantObject(field, key, schema).fields);

/** The fields one level below `field`, as addressed by a path segment */
const childFields = (field: DenseField, schema: DenseSchema, depth: number): DenseField[] => {
  switch (field.type) {
    case 'object':
      return field.fields;
    case 'optional':
      return [field.field];
    case 'union':
      return [discriminatorField(field), ...allVariantFields(field, schema)];
    case 'reference':
      // a reference to a template that is a reference to ... is bounded by the number of templates
      return depth > 64 ? [] : childFields(resolveTemplateOrThrow(field, schema), schema, depth + 1);
    case 'array':
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
    case 'enum_array':
    case 'reference_numeric':
      return [];
    default:
      return assertNeverDenseField(field);
  }
};

/**
 * Get a field definition by path (see the path grammar above)
 * @example getFieldByPath(schema, 'network.port') -> IntField
 * @example getFieldByPath(schema, 'users[].user.id') -> IntField
 * @returns the field, or `null` when the path does not exist
 */
export const getFieldByPath = (schema: DenseSchema, path: string): DenseField | null => {
  let candidates: readonly DenseField[] = schema.fields;
  let current: DenseField | null = null;

  for (const segment of path.split('.')) {
    const intoItems = segment.endsWith('[]');
    const name = intoItems ? segment.slice(0, -2) : segment;

    // legacy form: `list.child` for `list[].item.child`, when the items are an object
    if (!candidates.length && current?.type === 'array' && current.items.type === 'object')
      candidates = current.items.fields;

    current = candidates.find((f) => f.name === name) ?? null;
    if (!current) return null;

    if (intoItems) {
      if (current.type !== 'array') return null;
      candidates = [current.items];
    } else {
      candidates = childFields(current, schema, 0);
    }
  }

  return current;
};

const walkField = (
  field: DenseField,
  callback: (field: DenseField, path: string, parent?: DenseField) => void,
  prefix: string,
  schema: DenseSchema | undefined,
  parent?: DenseField,
  /** the variant templates being walked, so that a variant containing its own union ends */
  variantStack: Set<DenseField> = new Set()
) => {
  const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
  callback(field, fieldPath, parent);
  switch (field.type) {
    case 'object':
      field.fields.forEach((f) => walkField(f, callback, fieldPath, schema, field, variantStack));
      break;
    case 'array':
      walkField(field.items, callback, `${fieldPath}[]`, schema, field, variantStack);
      break;
    case 'optional':
      walkField(field.field, callback, fieldPath, schema, field, variantStack);
      break;
    case 'union':
      // the discriminator, then the fields of every variant; a variant already being walked further
      // up is skipped, like a reference
      walkField(discriminatorField(field), callback, fieldPath, schema, field, variantStack);
      for (const key of variantNames(field)) {
        const template = variantObject(field, key, schema);
        if (variantStack.has(template)) continue;
        variantStack.add(template);
        template.fields.forEach((f) => walkField(f, callback, fieldPath, schema, field, variantStack));
        variantStack.delete(template);
      }
      break;
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
    case 'enum_array':
    case 'reference_numeric':
    case 'reference':
      break;
    default:
      assertNeverDenseField(field);
  }
};

/**
 * Walk all fields in schema (including nested), in the path grammar above; `parent` is the
 * enclosing field (`undefined` at the top level). References are not followed.
 * @example walkDenseSchema(schema, (field, path) => console.log(path, field))
 */
export const walkDenseSchema = (
  schema: DenseSchema,
  callback: (field: DenseField, path: string, parent?: DenseField) => void,
  prefix = ''
): void => schema.fields.forEach((f) => walkField(f, callback, prefix, schema));

/**
 * Get all paths in schema
 * @example getAllPaths(schema) -> ['deviceId', 'deviceType', 'network.ssid', 'network.port', ...]
 */
export const getAllDenseSchemaPaths = (schema: DenseSchema): string[] => {
  const paths: string[] = [];
  walkDenseSchema(schema, (field, path) => paths.push(path));
  return paths;
};