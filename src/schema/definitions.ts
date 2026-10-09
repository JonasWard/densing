// definitions.ts - what `reference_numeric` and `reference` fields refer to: numeric definitions (and the
// preset of each a payload selects) and templates. Shared by the codec, `validate()` and the size analysis.
import {
  DenseField,
  DenseSchema,
  FixedPointField,
  IntField,
  NumericDefinition,
  ReferenceField,
  ReferenceNumericField
} from '../schema-type';
import type { ValidationError } from './validation';

/** Key of the data object that holds the active preset of every definition */
export const PRESETS_KEY = '$presets';

/** The active preset per definition name, as found under `$presets` in the data */
export type ActivePresets = Readonly<Record<string, unknown>>;

/** What a `reference_numeric` field is encoded as: the active preset of its definition */
export type NumericPresetField = IntField | FixedPointField;

/**
 * Definitions and materialised presets, so encoding does not re-walk them at every field.
 * Schemas are treated as immutable once they have been used for encoding or decoding.
 */
const definitionsByName = new WeakMap<DenseSchema, Map<string, NumericDefinition>>();
const presetFields = new WeakMap<NumericDefinition, Map<string, NumericPresetField>>();

const ownValue = (object: object, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(object, key) ? (object as Record<string, unknown>)[key] : undefined;

export const schemaDefinitions = (schema: DenseSchema): readonly NumericDefinition[] => schema.definitions ?? [];

/** Preset names in preset order: index `i` in the header is `presetNames(definition)[i]` */
export const presetNames = (definition: NumericDefinition): string[] => Object.keys(definition.presets);

export const defaultPresetName = (definition: NumericDefinition): string =>
  definition.defaultPreset ?? presetNames(definition)[0];

/** The preset `presets` selects for `definition`, or its default preset when it selects none */
export const activePresetName = (definition: NumericDefinition, presets?: ActivePresets): unknown => {
  const selected = presets ? ownValue(presets, definition.name) : undefined;
  return selected === undefined || selected === null ? defaultPresetName(definition) : selected;
};

export const findDefinition = (schema: DenseSchema, name: string): NumericDefinition | undefined => {
  let byName = definitionsByName.get(schema);
  if (!byName) {
    byName = new Map();
    // first one wins, `validateSchema` rejects duplicate names
    for (const definition of schemaDefinitions(schema))
      if (!byName.has(definition.name)) byName.set(definition.name, definition);
    definitionsByName.set(schema, byName);
  }
  return byName.get(name);
};

/** A preset as the concrete `int` (no precision) or `fixed` field values are encoded with */
export const presetField = (definition: NumericDefinition, presetName: string): NumericPresetField | undefined => {
  let fields = presetFields.get(definition);
  if (!fields) presetFields.set(definition, (fields = new Map()));
  if (!fields.has(presetName)) {
    const preset = ownValue(definition.presets, presetName) as NumericDefinition['presets'][string] | undefined;
    if (!preset) return undefined;
    const name = `${definition.name}.${presetName}`;
    const { min, max, precision } = preset;
    const defaultValue = preset.defaultValue ?? min;
    fields.set(
      presetName,
      precision === undefined
        ? { type: 'int', name, min, max, defaultValue }
        : { type: 'fixed', name, min, max, precision, defaultValue }
    );
  }
  return fields.get(presetName);
};

/** Every preset of a definition as a concrete field, in preset order */
export const allPresetFields = (definition: NumericDefinition): NumericPresetField[] =>
  presetNames(definition).flatMap((name) => presetField(definition, name) ?? []);

const invalidPreset = (definition: NumericDefinition, preset: unknown) =>
  `invalid preset ${JSON.stringify(preset)} for definition "${definition.name}", expected one of [${presetNames(definition).join(', ')}]`;

/**
 * The concrete field a `reference_numeric` field is encoded with under `presets`, or why there is none
 */
export const lookupNumeric = (
  field: ReferenceNumericField,
  schema: DenseSchema,
  presets?: ActivePresets
): { field: NumericPresetField } | { error: string } => {
  const definition = findDefinition(schema, field.ref);
  if (!definition) return { error: `definition "${field.ref}" does not exist` };
  const name = activePresetName(definition, presets);
  const concrete = typeof name === 'string' ? presetField(definition, name) : undefined;
  return concrete ? { field: concrete } : { error: invalidPreset(definition, name) };
};

/** `lookupNumeric`, throwing when there is no schema, no such definition or no such preset */
export const resolveNumericOrThrow = (
  field: ReferenceNumericField,
  schema: DenseSchema | undefined,
  presets?: ActivePresets
): NumericPresetField => {
  if (!schema) throw new Error(`reference_numeric field "${field.name}" requires schema context`);
  const result = lookupNumeric(field, schema, presets);
  if ('error' in result) throw new Error(`reference_numeric field "${field.name}": ${result.error}`);
  return result.field;
};

/**
 * Why the `$presets` value of the data is not valid for the schema. It may be left out, as may any
 * of its entries: those definitions use their default preset. Schemas without definitions ignore it.
 */
export const presetsErrors = (schema: DenseSchema, value: unknown): ValidationError[] => {
  const definitions = schemaDefinitions(schema);
  if (!definitions.length || value === undefined || value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return [{ path: PRESETS_KEY, message: 'expected object' }];

  const errors: ValidationError[] = [];
  for (const key of Object.keys(value))
    if (!findDefinition(schema, key))
      errors.push({ path: `${PRESETS_KEY}.${key}`, message: `definition "${key}" does not exist` });
  for (const definition of definitions) {
    const name = activePresetName(definition, value as ActivePresets);
    if (typeof name !== 'string' || !presetField(definition, name))
      errors.push({ path: `${PRESETS_KEY}.${definition.name}`, message: invalidPreset(definition, name) });
  }
  return errors;
};

export const schemaTemplates = (schema: DenseSchema): readonly DenseField[] => schema.templates ?? [];

/** The template a `reference` field refers to, `undefined` when `ref` is not an index into `templates` */
export const findTemplate = (schema: DenseSchema, ref: number): DenseField | undefined =>
  Number.isInteger(ref) && ref >= 0 ? schemaTemplates(schema)[ref] : undefined;

/** `findTemplate`, throwing when there is no schema or no such template */
export const resolveTemplateOrThrow = (field: ReferenceField, schema: DenseSchema | undefined): DenseField => {
  if (!schema) throw new Error(`reference field "${field.name}" requires schema context`);
  const template = findTemplate(schema, field.ref);
  if (!template) throw new Error(`reference field "${field.name}": template ${field.ref} does not exist`);
  return template;
};
