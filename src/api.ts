// api.ts - High-level API methods for schema introspection and size calculation
import { DenseSchema, DenseField, PointerField, ReferenceField, assertNeverDenseField } from './schema-type';
import {
  getBitWidthForContantBitWidthFields,
  bitsForEnumArrayContent,
  bitsForMinMaxLength,
  bitsForOptions
} from './densing';
import { resolvePointerOrThrow } from './schema/resolve';
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

type BitRange = { min: number; max: number };

/**
 * The fields a cycle can pass through: pointer targets and templates. Every other field is measured
 * inline, from the widths of the targets it refers to.
 */
type Target = DenseField;

const resolveTarget = (field: PointerField | ReferenceField, schema: DenseSchema | undefined): Target =>
  field.type === 'pointer' ? resolvePointerOrThrow(field, schema) : resolveTemplateOrThrow(field, schema);

/**
 * The width of `field` itself, with `target` giving the width of every pointer target / template it
 * refers to. The items of an array that is always empty are never measured: they hold no data.
 */
const inlineRange = (
  field: DenseField,
  schema: DenseSchema | undefined,
  target: (field: PointerField | ReferenceField) => BitRange
): BitRange => {
  const sum = (fields: DenseField[]) =>
    fields.reduce(
      (acc, f) => {
        const range = inlineRange(f, schema, target);
        return { min: acc.min + range.min, max: acc.max + range.max };
      },
      { min: 0, max: 0 }
    );

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
      // 1 bit for the presence flag, plus the field when present
      const innerRange = inlineRange(field.field, schema, target);
      return { min: 1, max: 1 + innerRange.max };
    }

    case 'array': {
      // Array: length bits + content bits
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      if (field.maxLength === 0) return { min: lengthBits, max: lengthBits };
      const itemRange = inlineRange(field.items, schema, target);
      return {
        min: lengthBits + repeatBits(field.minLength, itemRange.min),
        max: lengthBits + repeatBits(field.maxLength, itemRange.max)
      };
    }

    case 'enum_array': {
      // Enum array: length bits + packed enum content
      const lengthBits = bitsForMinMaxLength(field.minLength, field.maxLength);
      const base = field.enum.options.length;
      return {
        min: lengthBits + bitsForEnumArrayContent(field.minLength, base),
        max: lengthBits + bitsForEnumArrayContent(field.maxLength, base)
      };
    }

    case 'object':
      return sum(field.fields);

    case 'union': {
      // Union: discriminator bits + the smallest / largest variant
      const discriminatorBits = bitsForOptions(field.discriminator.options);
      const variantRanges = Object.values(field.variants).map(sum);
      return {
        min: discriminatorBits + Math.min(...variantRanges.map((r) => r.min)),
        max: discriminatorBits + Math.max(...variantRanges.map((r) => r.max))
      };
    }

    case 'pointer':
    case 'reference':
      return target(field);

    default:
      return assertNeverDenseField(field);
  }
};

/** Call `visit` for every pointer / reference in `field` that can hold data (see `inlineRange`) */
const forEachTargetRef = (field: DenseField, visit: (field: PointerField | ReferenceField) => void): void => {
  switch (field.type) {
    case 'optional':
      return forEachTargetRef(field.field, visit);
    case 'array':
      if (field.maxLength > 0) forEachTargetRef(field.items, visit);
      return;
    case 'object':
      return field.fields.forEach((f) => forEachTargetRef(f, visit));
    case 'union':
      return Object.values(field.variants).forEach((fields) => fields.forEach((f) => forEachTargetRef(f, visit)));
    case 'pointer':
    case 'reference':
      return visit(field);
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
    case 'enum_array':
    case 'reference_numeric':
      return;
    default:
      return assertNeverDenseField(field);
  }
};

/**
 * Bit width ranges for the fields of one schema. The widths of pointer targets and templates are
 * worked out once and shared, so measuring many fields of a schema whose templates refer to each
 * other stays linear in the size of the schema (following every path instead is exponential).
 *
 * - `min` is the smallest finite encoding. A smallest encoding never goes round a cycle, so it is the
 *   least fixed point of the widths: every target starts at `Infinity` and is lowered until nothing
 *   changes. A target that stays at `Infinity` has no finite value
 * - `max` is `Infinity` when the field can reach a cycle (the data can nest without limit)
 *
 * Only for internal use within one call: the schema must not change while the returned function is
 * in use.
 * @param schema - the root schema, required to resolve `pointer`, `reference` and `reference_numeric` fields
 */
export const bitWidthRanges = (schema: DenseSchema | undefined): ((field: DenseField) => BitRange) => {
  const minOf = new Map<Target, number>();
  const maxOf = new Map<Target, number>();
  // `solveMin` sets every target it reaches, a target not lowered yet has no known finite value
  const knownMin = (t: Target): number => minOf.get(t) ?? Infinity;

  /** Work out `min` for every target reachable from `field` that has none yet */
  const solveMin = (field: DenseField) => {
    // the new targets, dependencies first so that the iteration below settles quickly
    const pending: Target[] = [];
    const seen = new Set<Target>();
    const collect = (f: DenseField) =>
      forEachTargetRef(f, (ref) => {
        const t = resolveTarget(ref, schema);
        if (minOf.has(t) || seen.has(t)) return;
        seen.add(t);
        collect(t);
        pending.push(t);
      });
    collect(field);
    if (!pending.length) return;

    pending.forEach((t) => minOf.set(t, Infinity));
    const estimate = (ref: PointerField | ReferenceField): BitRange => ({
      min: knownMin(resolveTarget(ref, schema)),
      max: 0
    });
    // every pass lowers at least one target, or stops; each lowering follows a smallest encoding, so
    // there are at most `pending.length + 1` passes
    for (let changed = true; changed; ) {
      changed = false;
      for (const t of pending) {
        const min = inlineRange(t, schema, estimate).min;
        if (min < knownMin(t)) {
          minOf.set(t, min);
          changed = true;
        }
      }
    }
  };

  // depth first: a target that is reached again while it is being measured lies on a cycle, and so
  // does every target between the two, so their max is `Infinity`
  const expanding = new Set<Target>();
  const targetMax = (t: Target): number => {
    const known = maxOf.get(t);
    if (known !== undefined) return known;
    if (expanding.has(t)) return Infinity;
    expanding.add(t);
    const max = inlineRange(t, schema, (ref) => ({ min: 0, max: targetMax(resolveTarget(ref, schema)) })).max;
    expanding.delete(t);
    maxOf.set(t, max);
    return max;
  };

  return (field) => {
    solveMin(field);
    return inlineRange(field, schema, (ref) => {
      const t = resolveTarget(ref, schema);
      return { min: knownMin(t), max: targetMax(t) };
    });
  };
};

/**
 * Calculate the bit width RANGE for a field (min and max possible bits)
 * Returns the minimum and maximum number of bits that can be used to encode this field.
 * For recursive schemas `max` is `Infinity`: there is no static upper bound.
 * @param schema - the root schema, required to resolve `pointer` and `reference_numeric` fields
 */
export const getDenseFieldBitWidthRange = (field: DenseField, schema?: DenseSchema): { min: number; max: number } =>
  bitWidthRanges(schema)(field);

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
      const discriminatorBits = bitsForOptions(field.discriminator.options);
      const variantType = value?.[field.discriminator.name];
      if (!variantType) return discriminatorBits;

      const variantFields = field.variants[variantType] || [];
      const variantBits = variantFields.reduce(
        (sum, f) => sum + calculateDenseFieldBitWidth(f, value?.[f.name], schema, presets),
        0
      );
      return discriminatorBits + variantBits;
    }

    case 'pointer': {
      // Pointer: resolve the target field and calculate its bit width
      return calculateDenseFieldBitWidth(resolvePointerOrThrow(field, schema), value, schema, presets);
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

  const widths = bitWidthRanges(schema);
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
 * - pointer     `expr.left.value`            (`getFieldByPath` continues in the pointer's target;
 *                                            the walk does not, since that may recurse forever)
 */

/** The fields one level below `field`, as addressed by a path segment */
const childFields = (field: DenseField, schema: DenseSchema, pointerDepth: number): DenseField[] => {
  switch (field.type) {
    case 'object':
      return field.fields;
    case 'optional':
      return [field.field];
    case 'union':
      return [field.discriminator, ...Object.values(field.variants).flat()];
    case 'pointer':
      // a pointer to a pointer to ... is bounded by the number of fields in the schema
      return pointerDepth > 64 ? [] : childFields(resolvePointerOrThrow(field, schema), schema, pointerDepth + 1);
    case 'reference':
      return pointerDepth > 64 ? [] : childFields(resolveTemplateOrThrow(field, schema), schema, pointerDepth + 1);
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
  parent?: DenseField
) => {
  const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
  callback(field, fieldPath, parent);
  switch (field.type) {
    case 'object':
      field.fields.forEach((f) => walkField(f, callback, fieldPath, field));
      break;
    case 'array':
      walkField(field.items, callback, `${fieldPath}[]`, field);
      break;
    case 'optional':
      walkField(field.field, callback, fieldPath, field);
      break;
    case 'union':
      // Walk the discriminator field
      walkField(field.discriminator, callback, fieldPath, field);
      // Walk all variant fields
      Object.values(field.variants).forEach((variantFields) =>
        variantFields.forEach((f) => walkField(f, callback, fieldPath, field))
      );
      break;
    case 'bool':
    case 'int':
    case 'fixed':
    case 'enum':
    case 'enum_array':
    case 'pointer':
    case 'reference_numeric':
    case 'reference':
      break;
    default:
      assertNeverDenseField(field);
  }
};

/**
 * Walk all fields in schema (including nested), in the path grammar above; `parent` is the
 * enclosing field (`undefined` at the top level). Pointers are not followed.
 * @example walkDenseSchema(schema, (field, path) => console.log(path, field))
 */
export const walkDenseSchema = (
  schema: DenseSchema,
  callback: (field: DenseField, path: string, parent?: DenseField) => void,
  prefix = ''
): void => schema.fields.forEach((f) => walkField(f, callback, prefix));

/**
 * Get all paths in schema
 * @example getAllPaths(schema) -> ['deviceId', 'deviceType', 'network.ssid', 'network.port', ...]
 */
export const getAllDenseSchemaPaths = (schema: DenseSchema): string[] => {
  const paths: string[] = [];
  walkDenseSchema(schema, (field, path) => paths.push(path));
  return paths;
};