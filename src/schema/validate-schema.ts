import { DenseField, DenseSchema, assertNeverDenseField } from '../schema-type';
import { getDenseFieldBitWidthRange } from '../api';
import { resolveDenseFieldByName } from './resolve';
import { ValidationError, ValidationResult } from './validation';
import { PRESETS_KEY, findDefinition, findTemplate, presetNames, schemaDefinitions, schemaTemplates } from './definitions';

/**
 * Every field a pointer can resolve to, with its path, in the order `resolveDenseFieldByName`
 * searches them. Union discriminators are not pointer targets.
 */
const collectPointerCandidates = (
  fields: DenseField[],
  prefix: string,
  out: { field: DenseField; path: string }[]
): { field: DenseField; path: string }[] => {
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    out.push({ field, path });
    switch (field.type) {
      case 'object':
        collectPointerCandidates(field.fields, path, out);
        break;
      case 'union':
        Object.values(field.variants).forEach((variantFields) => collectPointerCandidates(variantFields, path, out));
        break;
      case 'array':
        collectPointerCandidates([field.items], `${path}[]`, out);
        break;
      case 'optional':
        collectPointerCandidates([field.field], path, out);
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
  }
  return out;
};

/**
 * Check the parts of a schema that the field builders cannot check on their own, because they
 * depend on the whole schema. `schema()` runs this and throws on the first error; call it directly
 * for schemas built by hand or loaded from JSON.
 *
 * Pointer rules:
 * - the target must exist
 * - the target name must be unique among all fields a pointer can resolve to (object fields, union
 *   variant fields, array items, optional inner fields), so which field a pointer refers to never
 *   depends on declaration order
 * - the target must have a finite value: a cycle has to pass through a union variant, an optional or
 *   an array that may be empty, otherwise no data can ever be encoded (and `pointer('p', 'p')`
 *   would loop forever)
 *
 * Numeric definition rules:
 * - definition names are unique, every definition has at least one preset and its default preset
 *   is one of them
 * - every `reference_numeric` field refers to an existing definition
 * - no top-level field is called `$presets`, the data key that selects the presets
 *
 * Template rules:
 * - every `reference` field's `ref` is an index into `templates`
 * - template names are unique, and every template is referenced (from the fields, or from a template
 *   that is): templates exist only to be referenced
 * - every template has a finite value, like a pointer target
 * - templates are not pointer targets; pointers inside templates are checked like the others
 */
export const validateSchema = (schema: DenseSchema): ValidationResult => {
  const errors: ValidationError[] = [];
  const candidates = collectPointerCandidates(schema.fields, '', []);
  // the fields inside each template, with paths like `templates[0].x`
  const templateCandidates = schemaTemplates(schema).map((template, i) =>
    collectPointerCandidates([template], `templates[${i}]`, []).map(({ field, path }) => ({
      field,
      path: path.replace(`templates[${i}].${template.name}`, `templates[${i}]`)
    }))
  );
  const allCandidates = [...candidates, ...templateCandidates.flat()];

  validateDefinitions(schema, allCandidates, errors);
  validateTemplates(schema, candidates, templateCandidates, errors);
  // the checks below compute bit widths, which need every definition and template to resolve
  if (errors.length) return { valid: false, errors };

  schemaTemplates(schema).forEach((template, i) => {
    if (getDenseFieldBitWidthRange(template, schema).min === Infinity)
      errors.push({
        path: `templates[${i}]`,
        message: `template "${template.name}" has no finite value: every path through it recurses forever`
      });
  });

  const byName = new Map<string, string[]>();
  for (const { field, path } of candidates) byName.set(field.name, [...(byName.get(field.name) ?? []), path]);

  const checkedTargets = new Set<DenseField>();
  for (const { field, path } of allCandidates) {
    if (field.type !== 'pointer') continue;
    const paths = byName.get(field.targetName) ?? [];

    if (paths.length === 0) {
      errors.push({ path, message: `pointer target "${field.targetName}" does not exist` });
      continue;
    }
    if (paths.length > 1) {
      errors.push({
        path,
        message: `pointer target "${field.targetName}" is ambiguous, it matches ${paths.join(', ')}`
      });
      continue;
    }

    const target = resolveDenseFieldByName(schema, field.targetName)!;
    if (checkedTargets.has(target)) continue;
    checkedTargets.add(target);
    if (getDenseFieldBitWidthRange(target, schema).min === Infinity)
      errors.push({
        path,
        message: `pointer target "${field.targetName}" has no finite value: every path through it recurses forever`
      });
  }

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
  for (const { field, path } of [...candidates, ...templateCandidates.flat()])
    if (field.type === 'reference' && !findTemplate(schema, field.ref)) {
      errors.push({ path, message: `template ${field.ref} does not exist` });
      refsValid = false;
    }
  if (!refsValid) return;

  // templates reachable from the fields
  const referenced = new Set<number>();
  const visit = (list: Candidate[]) => {
    for (const { field } of list)
      if (field.type === 'reference' && !referenced.has(field.ref)) {
        referenced.add(field.ref);
        visit(templateCandidates[field.ref]);
      }
  };
  visit(candidates);
  templates.forEach((template, i) => {
    if (!referenced.has(i))
      errors.push({ path: `templates[${i}]`, message: `template "${template.name}" is never referenced` });
  });
};

/** Throw when `validateSchema` reports an error */
export const assertValidSchema = (schema: DenseSchema): void => {
  const { errors } = validateSchema(schema);
  if (errors.length) throw new Error(`invalid schema: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
};
