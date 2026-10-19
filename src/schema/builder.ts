import {
  BoolField,
  IntField,
  EnumField,
  FixedPointField,
  DenseField,
  ArrayField,
  UnionField,
  EnumArrayField,
  OptionalField,
  ObjectField,
  NumericDefinition,
  NumericPreset,
  ReferenceNumericField,
  ReferenceField,
  DenseSchema
} from '../schema-type';
import { MAX_FIELD_BITS, constantFieldValueError, fixedMaxStep } from '../values';
import { validateField, ValidationError } from './validation';
import { assertValidSchema } from './validate-schema';
import { linkVariants, variantLinksOf, variantNames } from './variants';

/** Throw when a field's default value would not pass `validate` / `densing` */
const assertValidDefault = (type: string, field: DenseField, defaultValue: unknown) => {
  const errors: ValidationError[] = [];
  validateField(field, defaultValue, field.name, errors);
  if (errors.length)
    throw new Error(`${type} "${field.name}": invalid default value (${errors.map((e) => e.message).join('; ')})`);
};

/** Throw when two fields that end up as keys of the same data object share a name */
const assertUniqueNames = (context: string, fields: readonly DenseField[]) => {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) throw new Error(`${context}: duplicate field name "${f.name}"`);
    seen.add(f.name);
  }
};

/* =========================
 * Primitive Field Helpers
 * ========================= */

export const bool = (name: string, defaultValue: boolean = false): BoolField => {
  const field: BoolField = { type: 'bool', name, defaultValue };
  const error = constantFieldValueError(field, defaultValue);
  if (error) throw new Error(`bool "${name}": invalid default value (${error})`);
  return field;
};

export const int = (name: string, min: number, max: number, defaultValue?: number): IntField => {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max))
    throw new Error(`int "${name}": min and max must be safe integers`);
  if (max < min) throw new Error(`int "${name}": max < min`);
  if (max - min >= 2 ** MAX_FIELD_BITS)
    throw new Error(`int "${name}": range [${min}, ${max}] needs more than ${MAX_FIELD_BITS} bits`);
  const field: IntField = { type: 'int', name, min, max, defaultValue: defaultValue ?? min };
  const error = constantFieldValueError(field, field.defaultValue);
  if (error) throw new Error(`int "${name}": invalid default value (${error})`);
  return field;
};

export const enumeration = (name: string, options: readonly string[], defaultValue?: string): EnumField => {
  if (options.length < 1) throw new Error(`enum "${name}": must have at least 1 value`);
  if (options.some((o) => typeof o !== 'string')) throw new Error(`enum "${name}": options must be strings`);
  if (new Set(options).size !== options.length) throw new Error(`enum "${name}": duplicate values`);
  const field: EnumField = { type: 'enum', name, options, defaultValue: defaultValue ?? options[0] };
  const error = constantFieldValueError(field, field.defaultValue);
  if (error) throw new Error(`enum "${name}": invalid default value (${error})`);
  return field;
};

export const fixed = (
  name: string,
  min: number,
  max: number,
  precision: number,
  defaultValue?: number
): FixedPointField => {
  if (precision <= 0) {
    throw new Error(`fixed "${name}": precision must be > 0`);
  }
  const scale = 1 / precision;
  if (!Number.isInteger(scale)) {
    throw new Error(`fixed "${name}": 1 / precision must be an integer`);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`fixed "${name}": min and max must be finite numbers`);
  }
  if (max < min) {
    throw new Error(`fixed "${name}": max < min`);
  }
  if (fixedMaxStep(min, max, precision) >= 2 ** MAX_FIELD_BITS) {
    throw new Error(`fixed "${name}": range [${min}, ${max}] at precision ${precision} needs more than ${MAX_FIELD_BITS} bits`);
  }
  const field: FixedPointField = { type: 'fixed', name, min, max, precision, defaultValue: defaultValue ?? min };
  const error = constantFieldValueError(field, field.defaultValue);
  if (error) throw new Error(`fixed "${name}": invalid default value (${error})`);
  return field;
};

const minMaxValidation = (type: string, name: string, minLength: number, maxLength: number) => {
  if (!Number.isInteger(minLength) || minLength < 0)
    throw new Error(`fixedArray ${type} "${name}": minLength (${minLength}) must be a positive integer`);
  if (!Number.isInteger(maxLength) || maxLength <= 0)
    throw new Error(`fixedArray ${type} "${name}": maxLength (${maxLength}) must be a positive integer`);
  if (maxLength < minLength)
    throw new Error(
      `fixedArray ${type} "${name}": maxLength (${maxLength}) must be larger than minLength (${minLength})`
    );
};

/* =========================
 * Array Helpers
 * ========================= */
export const array = (name: string, minLength: number, maxLength: number, items: DenseField): ArrayField => {
  minMaxValidation('array', name, minLength, maxLength);

  return {
    type: 'array',
    name,
    minLength,
    maxLength,
    items
  };
};

/* =========================
 * Union Helpers
 * ========================= */

/** A union variant: its fields, or an object template (a function for a template defined later) */
export type Variant = DenseField[] | Template | (() => Template);

/** Variant names JS objects would reorder (integer-like keys come first), so they cannot keep their order */
const isIndexLike = (key: string) => /^(0|[1-9]\d*)$/.test(key);

/** Templates made from a variant's fields: `schema()` stores templates with the same shape once */
const anonymousTemplates = new WeakSet<DenseField>();

/**
 * One of several variants, told apart by the `discriminator` key of the data. Each variant is an
 * object template; its data is the template's fields next to the discriminator:
 * `union('shape', 'type', { circle: [int('r', 0, 7)], square: [int('side', 0, 7)] })` holds
 * `{ type: 'circle', r: 3 }`. A variant given as fields becomes a template too, and variants with
 * the same fields share one.
 * @param discriminator - the data key that holds the variant's name (an enum of the variant names
 * is still accepted, deprecated)
 * @param variants - in the order of the encoded index
 * @param defaultVariant - the variant of the default data, the first one when not given
 */
export const union = (
  name: string,
  discriminator: string | EnumField,
  variants: Record<string, Variant>,
  defaultVariant?: string
): UnionField => {
  let key = discriminator as string;
  if (typeof discriminator !== 'string') {
    // deprecated form: the enum's options are the variant names, its default is the default variant
    const { options } = discriminator;
    for (const value of options)
      if (!variants[value]) throw new Error(`union "${name}": missing variant definition for "${value}"`);
    for (const value of Object.keys(variants))
      if (!options.includes(value))
        throw new Error(`union "${name}": variant "${value}" is not an option of discriminator "${discriminator.name}"`);
    key = discriminator.name;
    variants = Object.fromEntries(options.map((option) => [option, variants[option]]));
    defaultVariant ??= discriminator.defaultValue;
  }
  const names = Object.keys(variants);
  if (!names.length) throw new Error(`union "${name}": needs at least one variant`);
  for (const variant of names)
    if (isIndexLike(variant))
      throw new Error(`union "${name}": variant "${variant}" looks like an index, JS objects would reorder it`);
  if (defaultVariant !== undefined && !names.includes(defaultVariant))
    throw new Error(`union "${name}": default variant "${defaultVariant}" is not one of [${names.join(', ')}]`);

  const links: Record<string, Template | (() => Template)> = {};
  for (const variant of names) {
    const value = variants[variant];
    const context = `union "${name}" variant "${variant}"`;
    if (Array.isArray(value)) {
      assertUniqueNames(context, value);
      const shape = template(object(variant, ...value));
      anonymousTemplates.add(shape);
      links[variant] = shape;
    } else if (typeof value === 'function') links[variant] = value;
    else if (value && templates.has(value)) links[variant] = value;
    else throw new Error(`${context}: expected fields or a template`);
    // a template given directly can be checked now, one behind a function only by `schema()`
    const shape = links[variant];
    if (typeof shape !== 'function') {
      if (shape.type !== 'object') throw new Error(`${context}: the template must be an object, got "${shape.type}"`);
      // the variant's fields share one data object with the discriminator
      if (shape.fields.some((f) => f.name === key)) throw new Error(`${context}: duplicate field name "${key}"`);
    }
  }

  const field: UnionField = {
    type: 'union',
    name,
    discriminator: key,
    variants: Object.fromEntries(names.map((variant) => [variant, -1])),
    ...(defaultVariant !== undefined && defaultVariant !== names[0] ? { defaultVariant } : {})
  };
  linkVariants(field, links);
  return field;
};

/* =========================
 * Enum Array Helpers
 * ========================= */

export const enumArray = (
  name: string,
  enumDef: EnumField,
  minLength: number,
  maxLength: number,
  defaultValue?: string[]
): EnumArrayField => {
  minMaxValidation('enum_array', name, minLength, maxLength);

  const field: EnumArrayField = {
    type: 'enum_array',
    name,
    enum: enumDef,
    minLength,
    maxLength,
    // without an explicit default: the shortest valid array, filled with the enum's default
    defaultValue: defaultValue ?? Array.from({ length: minLength }, () => enumDef.defaultValue)
  };
  assertValidDefault('enum_array', field, field.defaultValue);
  return field;
};

/* =========================
 * Optional Field Helpers
 * ========================= */

export const optional = (name: string, field: DenseField, defaultValue?: any): OptionalField => {
  if (defaultValue !== undefined && defaultValue !== null) {
    const errors: ValidationError[] = [];
    validateField(field, defaultValue, name, errors);
    if (errors.length)
      throw new Error(`optional "${name}": invalid default value (${errors.map((e) => e.message).join('; ')})`);
  }
  return {
    type: 'optional',
    name,
    field,
    defaultValue
  };
};

/* =========================
 * Object Field Helpers
 * ========================= */

export const object = (name: string, ...fields: DenseField[]): ObjectField => {
  assertUniqueNames(`object "${name}"`, fields);
  return {
    type: 'object',
    name,
    fields
  };
};

/* =========================
 * Numeric Definition Helpers
 * ========================= */

/**
 * A numeric definition, shared by the `reference_numeric` fields that refer to it by name. Each preset
 * is an `int` (without `precision`) or a `fixed` (with it), checked like the `int` / `fixed` builders
 * check theirs. Every payload stores which preset is active (in `bits(presets)` bits, so none for a
 * single preset) and all referencing fields are encoded with it.
 * @param presets - in the order of the indices stored in the payload
 * @param defaultPreset - the preset used when the data does not select one, the first by default
 */
export const definition = (
  name: string,
  presets: Record<string, NumericPreset>,
  defaultPreset?: string
): NumericDefinition => {
  const names = Object.keys(presets);
  if (!names.length) throw new Error(`definition "${name}": must have at least 1 preset`);
  const normalized: Record<string, NumericPreset> = {};
  for (const presetName of names) {
    const { min, max, precision, defaultValue } = presets[presetName];
    const label = `${name}.${presetName}`;
    try {
      const field = precision === undefined ? int(label, min, max, defaultValue) : fixed(label, min, max, precision, defaultValue);
      normalized[presetName] =
        field.type === 'fixed'
          ? { min, max, precision: field.precision, defaultValue: field.defaultValue }
          : { min, max, defaultValue: field.defaultValue };
    } catch (error) {
      throw new Error(`definition "${name}" preset "${presetName}": ${error instanceof Error ? error.message : error}`);
    }
  }
  if (defaultPreset !== undefined && !names.includes(defaultPreset))
    throw new Error(`definition "${name}": default preset "${defaultPreset}" is not one of [${names.join(', ')}]`);
  return { name, presets: normalized, defaultPreset: defaultPreset ?? names[0] };
};

/** Definitions behind `referenceNumeric(name, definition)`, collected by `schema()` */
const definitionLinks = new WeakMap<ReferenceNumericField, NumericDefinition>();

/**
 * A number whose range and precision come from the active preset of a numeric definition. Passing
 * the definition itself is enough: `schema()` collects it. A name only works with
 * `schemaWithDefinitions`, which is given the definition.
 * @param ref - the definition, or its name
 */
export const referenceNumeric = (name: string, ref: NumericDefinition | string): ReferenceNumericField => {
  const field: ReferenceNumericField = { type: 'reference_numeric', name, ref: typeof ref === 'string' ? ref : ref.name };
  if (typeof ref !== 'string') definitionLinks.set(field, ref);
  return field;
};

/* =========================
 * Template Helpers
 * ========================= */

declare const templateBrand: unique symbol;

/** A field marked with `template()`: a reference-only shape */
export type Template<T extends DenseField = DenseField> = T & { readonly [templateBrand]: true };

const templates = new WeakSet<DenseField>();
/** Templates behind `reference(name, template)`, bound to an index by `schema()` */
const templateLinks = new WeakMap<ReferenceField, Template | (() => Template)>();

/**
 * Mark a field as a template: a reference-only shape. It is never a value itself, only the shape of
 * the `reference` fields that use it, and `schema()` stores it once under `templates`. Its name is
 * the name of the type (`generateTypes` turns `vec3` into `Vec3`), not a key in the data.
 */
export const template = <T extends DenseField>(field: T): Template<T> => {
  templates.add(field);
  return field as Template<T>;
};

/**
 * A value shaped like a template. Encoded exactly as the template; `schema()` collects the template
 * and sets `ref` to its index in `templates`.
 * @param target - the template, or a function returning it for a template that refers to itself
 */
export const reference = (name: string, target: Template | (() => Template)): ReferenceField => {
  if (typeof target !== 'function' && !templates.has(target))
    throw new Error(`reference "${name}": "${target?.name}" is not a template, mark it with template()`);
  const field: ReferenceField = { type: 'reference', name, ref: -1 };
  templateLinks.set(field, target);
  return field;
};

/* =========================
 * Schema Root Helper
 * ========================= */

/**
 * Collect the templates and numeric definitions the fields refer to, and give each `reference` its
 * template index. Fields without references are kept as they are; on the path to a reference the
 * containers are copied, so the input fields are never changed.
 */
const bindReferences = (
  fields: DenseField[],
  explicitDefinitions: NumericDefinition[] | undefined,
  explicitTemplates: DenseField[] | undefined
) => {
  const definitions = [...(explicitDefinitions ?? [])];
  const boundTemplates: DenseField[] = [];
  const templateIndex = new Map<DenseField, number>();

  const addDefinition = (found: NumericDefinition) => {
    const known = definitions.find((d) => d.name === found.name);
    if (!known) definitions.push(found);
    else if (known !== found && JSON.stringify(known) !== JSON.stringify(found))
      throw new Error(`schema: two different definitions are called "${found.name}"`);
  };

  const indexOf = (target: DenseField): number => {
    let index = templateIndex.get(target);
    if (index === undefined) {
      index = boundTemplates.length;
      templateIndex.set(target, index);
      boundTemplates.push(target); // placeholder, so a template referring to itself finds its index
      boundTemplates[index] = bind(target);
    }
    return index;
  };

  // templates made from variant fields, by shape: variants with the same fields share one
  const anonymousIndex = new Map<string, number>();
  const anonymous = new Set<number>();
  const variantIndex = (target: DenseField): number => {
    if (!anonymousTemplates.has(target)) return indexOf(target);
    let index = templateIndex.get(target);
    if (index !== undefined) return index;
    // fields of a variant cannot refer to their own template, so binding first is safe
    const bound = bind(target) as ObjectField;
    const shape = JSON.stringify(bound.fields);
    index = anonymousIndex.get(shape);
    if (index === undefined) {
      index = boundTemplates.length;
      boundTemplates.push(bound);
      anonymousIndex.set(shape, index);
      anonymous.add(index);
    }
    templateIndex.set(target, index);
    return index;
  };

  const bindAll = (list: DenseField[]): DenseField[] => {
    const bound = list.map(bind);
    return bound.every((f, i) => f === list[i]) ? list : bound;
  };

  const bind = (field: DenseField): DenseField => {
    switch (field.type) {
      case 'reference': {
        const link = templateLinks.get(field);
        if (!link) return field; // already bound, e.g. loaded from JSON
        const target = typeof link === 'function' ? link() : link;
        if (!target || !templates.has(target))
          throw new Error(`reference "${field.name}": the target is not a template, mark it with template()`);
        return { type: 'reference', name: field.name, ref: indexOf(target) };
      }
      case 'reference_numeric': {
        const linked = definitionLinks.get(field);
        if (linked) addDefinition(linked);
        return field;
      }
      case 'object': {
        const bound = bindAll(field.fields);
        return bound === field.fields ? field : { ...field, fields: bound };
      }
      case 'array': {
        const items = bind(field.items);
        return items === field.items ? field : { ...field, items };
      }
      case 'optional': {
        const inner = bind(field.field);
        return inner === field.field ? field : { ...field, field: inner };
      }
      case 'union': {
        const links = variantLinksOf(field);
        let bound = field; // already bound, e.g. loaded from JSON
        if (links) {
          const variants: Record<string, number> = {};
          for (const variant of variantNames(field)) {
            const link = links[variant];
            const target = typeof link === 'function' ? link() : link;
            if (!target || !templates.has(target))
              throw new Error(`union "${field.name}" variant "${variant}": the target is not a template, mark it with template()`);
            variants[variant] = variantIndex(target);
          }
          bound = { ...field, variants };
        }
        // the schema's unions find their variants on their own, like before templates (e.g. to measure
        // a field without passing the schema)
        linkVariants(
          bound,
          Object.fromEntries(Object.entries(bound.variants).map(([variant, index]) => [variant, () => boundTemplates[index]]))
        );
        return bound;
      }
      default:
        return field;
    }
  };

  // templates given explicitly (from JSON) keep their indices; the ones found through references follow
  explicitTemplates?.forEach((t, i) => {
    templateIndex.set(t, i);
    boundTemplates.push(t);
  });
  explicitTemplates?.forEach((t, i) => (boundTemplates[i] = bind(t)));
  const boundFields = bindAll(fields);

  // template names are unique: a template made from variant fields is named after the first variant
  // that uses it, numbered when another template already has that name
  const used = new Set(boundTemplates.filter((_, i) => !anonymous.has(i)).map((t) => t.name));
  for (const i of [...anonymous].sort((a, b) => a - b)) {
    const base = boundTemplates[i].name;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
    used.add(name);
    if (name !== base) boundTemplates[i] = { ...boundTemplates[i], name };
  }
  return { definitions, templates: boundTemplates, fields: boundFields };
};

/**
 * Build and check a schema from its parts. `definitions` / `templates` given here are always kept
 * (also when empty); the ones collected from the fields are added after them.
 */
export const schemaFromParts = (
  parts: { definitions?: NumericDefinition[]; templates?: DenseField[] },
  fields: DenseField[]
): DenseSchema => {
  assertUniqueNames('schema', fields);
  const bound = bindReferences(fields, parts.definitions, parts.templates);
  const result: DenseSchema = {
    ...(parts.definitions || bound.definitions.length ? { definitions: bound.definitions } : {}),
    ...(parts.templates || bound.templates.length ? { templates: bound.templates } : {}),
    fields: bound.fields
  };
  assertValidSchema(result);
  return result;
};

/** What `schema()` returns: the fields, plus the templates and definitions they refer to */
export type BuiltSchema<T extends DenseField[]> = {
  readonly definitions?: NumericDefinition[];
  readonly templates?: DenseField[];
  readonly fields: T;
};

/**
 * The root of a schema. Collects the templates of its `reference` fields and the numeric definitions
 * of its `referenceNumeric` fields and union variants, and checks the schema as a whole
 * (`validateSchema`).
 */
export const schema = <const T extends DenseField[]>(...fields: T): BuiltSchema<T> =>
  schemaFromParts({}, fields) as BuiltSchema<T>;

/**
 * `schema()` with numeric definitions given up front, for `reference_numeric` fields that refer to a
 * definition by name. Definitions passed as objects to `referenceNumeric` need no listing here.
 */
export const schemaWithDefinitions = <const T extends DenseField[]>(
  definitions: NumericDefinition[],
  ...fields: T
): BuiltSchema<T> & { readonly definitions: NumericDefinition[] } =>
  schemaFromParts({ definitions }, fields) as BuiltSchema<T> & { readonly definitions: NumericDefinition[] };
