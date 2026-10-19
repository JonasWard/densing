import { DenseField, DenseSchema, UnionField, assertNeverDenseField } from '../schema-type';
import { schemaRanges } from '../api';
import { ValidationError, ValidationResult } from './validation';
import { variantNames } from './variants';
import { PRESETS_KEY, findDefinition, findTemplate, presetNames, schemaDefinitions, schemaTemplates } from './definitions';

/**
 * Every field with its path, depth first. Union variants are templates, whose fields are collected
 * with the templates.
 */
const collectCandidates = (
  fields: DenseField[],
  prefix: string,
  out: { field: DenseField; path: string }[]
): { field: DenseField; path: string }[] => {
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    out.push({ field, path });
    switch (field.type) {
      case 'object':
        collectCandidates(field.fields, path, out);
        break;
      case 'array':
        collectCandidates([field.items], `${path}[]`, out);
        break;
      case 'optional':
        collectCandidates([field.field], path, out);
        break;
      case 'union':
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
  }
  return out;
};

/**
 * Check the parts of a schema that the field builders cannot check on their own, because they
 * depend on the whole schema. `schema()` runs this and throws on the first error; call it directly
 * for schemas built by hand or loaded from JSON.
 *
 * Numeric definition rules:
 * - definition names are unique, every definition has at least one preset and its default preset
 *   is one of them
 * - every `reference_numeric` field refers to an existing definition
 * - no top-level field is called `$presets`, the data key that selects the presets
 *
 * Template rules:
 * - every `reference` field's `ref` and every union variant is an index into `templates`
 * - template names are unique, and every template is referenced (from the fields, or from a template
 *   that is): templates exist only to be referenced
 * - every template has a finite value: a cycle has to pass through a union variant, an optional or
 *   an array that may be empty, otherwise no data can ever be encoded
 *
 * Union rules:
 * - a union has at least one variant; variant names are not integer-like (JS objects would reorder
 *   them), and the default variant is one of them
 * - every variant's template is an object (or a reference to one), and none of its fields is named
 *   like the discriminator: they share one data object
 */
export const validateSchema = (schema: DenseSchema): ValidationResult => {
  const errors: ValidationError[] = [];
  const candidates = collectCandidates(schema.fields, '', []);
  // the fields inside each template, with paths like `templates[0].x`
  const templateCandidates = schemaTemplates(schema).map((template, i) =>
    collectCandidates([template], `templates[${i}]`, []).map(({ field, path }) => ({
      field,
      path: path.replace(`templates[${i}].${template.name}`, `templates[${i}]`)
    }))
  );
  const allCandidates = [...candidates, ...templateCandidates.flat()];

  validateDefinitions(schema, allCandidates, errors);
  validateTemplates(schema, candidates, templateCandidates, errors);
  // the checks below compute bit widths, which need every definition and template to resolve
  if (errors.length) return { valid: false, errors };

  const widths = schemaRanges(schema);
  schemaTemplates(schema).forEach((template, i) => {
    if (widths(template).min === Infinity)
      errors.push({
        path: `templates[${i}]`,
        message: `template "${template.name}" has no finite value: every path through it recurses forever`
      });
  });

  return { valid: errors.length === 0, errors };
};

const validateDefinitions = (schema: DenseSchema, candidates: Candidate[], errors: ValidationError[]) => {
  const definitions = schemaDefinitions(schema);
  const seen = new Set<string>();
  definitions.forEach((definition, i) => {
    const path = `definitions[${i}]`;
    if (seen.has(definition.name)) errors.push({ path, message: `duplicate definition name "${definition.name}"` });
    seen.add(definition.name);
    const names = presetNames(definition);
    if (!names.length) errors.push({ path, message: `definition "${definition.name}" has no presets` });
    else if (definition.defaultPreset !== undefined && !names.includes(definition.defaultPreset))
      errors.push({
        path,
        message: `default preset "${definition.defaultPreset}" of definition "${definition.name}" is not one of [${names.join(', ')}]`
      });
  });

  if (definitions.length && schema.fields.some((field) => field.name === PRESETS_KEY))
    errors.push({ path: PRESETS_KEY, message: `"${PRESETS_KEY}" is reserved for the presets of the definitions` });

  for (const { field, path } of candidates)
    if (field.type === 'reference_numeric' && !findDefinition(schema, field.ref))
      errors.push({ path, message: `definition "${field.ref}" does not exist` });
};

type Candidate = { field: DenseField; path: string };

const validateTemplates = (
  schema: DenseSchema,
  candidates: Candidate[],
  templateCandidates: Candidate[][],
  errors: ValidationError[]
) => {
  const templates = schemaTemplates(schema);
  const seen = new Set<string>();
  templates.forEach((template, i) => {
    if (seen.has(template.name))
      errors.push({ path: `templates[${i}]`, message: `duplicate template name "${template.name}"` });
    seen.add(template.name);
  });

  let refsValid = true;
  for (const { field, path } of [...candidates, ...templateCandidates.flat()]) {
    if (field.type === 'reference' && !findTemplate(schema, field.ref)) {
      errors.push({ path, message: `template ${field.ref} does not exist` });
      refsValid = false;
    }
    if (field.type === 'union' && !validateUnion(schema, field, path, errors)) refsValid = false;
  }
  if (!refsValid) return;

  // templates reachable from the fields
  const referenced = new Set<number>();
  const visit = (list: Candidate[]) => {
    for (const { field } of list) {
      const refs = field.type === 'reference' ? [field.ref] : field.type === 'union' ? Object.values(field.variants) : [];
      for (const ref of refs)
        if (!referenced.has(ref)) {
          referenced.add(ref);
          visit(templateCandidates[ref]);
        }
    }
  };
  visit(candidates);
  templates.forEach((template, i) => {
    if (!referenced.has(i))
      errors.push({ path: `templates[${i}]`, message: `template "${template.name}" is never referenced` });
  });
};

/** The union rules; false when a variant's template does not resolve to an object */
const validateUnion = (schema: DenseSchema, field: UnionField, path: string, errors: ValidationError[]): boolean => {
  const names = variantNames(field);
  if (!names.length) errors.push({ path, message: `union "${field.name}" has no variants` });
  if (field.defaultVariant !== undefined && !names.includes(field.defaultVariant))
    errors.push({ path, message: `default variant "${field.defaultVariant}" is not one of [${names.join(', ')}]` });
  let resolved = true;
  for (const key of names) {
    const at = `${path}.variants.${key}`;
    if (/^(0|[1-9]\d*)$/.test(key))
      errors.push({ path: at, message: `variant "${key}" looks like an index, JS objects would reorder it` });
    const index = field.variants[key];
    let template = Number.isInteger(index) ? findTemplate(schema, index) : undefined;
    // a template that is a reference to another template
    for (let depth = 0; template?.type === 'reference' && depth < 64; depth++) template = findTemplate(schema, template.ref);
    if (!template) {
      errors.push({ path: at, message: `template ${index} does not exist` });
      resolved = false;
    } else if (template.type !== 'object') {
      errors.push({ path: at, message: `the template of a variant must be an object, got "${template.type}"` });
      resolved = false;
    } else if (template.fields.some((f) => f.name === field.discriminator))
      errors.push({ path: at, message: `field "${field.discriminator}" has the name of the discriminator` });
  }
  return resolved;
};

/** Throw when `validateSchema` reports an error */
export const assertValidSchema = (schema: DenseSchema): void => {
  const { errors } = validateSchema(schema);
  if (errors.length) throw new Error(`invalid schema: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
};
