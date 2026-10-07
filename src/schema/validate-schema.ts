import { DenseField, DenseSchema, assertNeverDenseField } from '../schema-type';
import { getDenseFieldBitWidthRange } from '../api';
import { resolveDenseFieldByName } from './resolve';
import { ValidationError, ValidationResult } from './validation';

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
 */
export const validateSchema = (schema: DenseSchema): ValidationResult => {
  const errors: ValidationError[] = [];
  const candidates = collectPointerCandidates(schema.fields, '', []);

  const byName = new Map<string, string[]>();
  for (const { field, path } of candidates) byName.set(field.name, [...(byName.get(field.name) ?? []), path]);

  const checkedTargets = new Set<DenseField>();
  for (const { field, path } of candidates) {
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

/** Throw when `validateSchema` reports an error */
export const assertValidSchema = (schema: DenseSchema): void => {
  const { errors } = validateSchema(schema);
  if (errors.length) throw new Error(`invalid schema: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
};
