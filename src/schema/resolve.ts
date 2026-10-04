import { DenseField, DenseSchema, PointerField, assertNeverDenseField } from '../schema-type';

/**
 * Pointer targets per schema, so recursive data does not re-walk the schema at every node.
 * Schemas are treated as immutable once they have been used for encoding or decoding.
 */
const resolvedTargets = new WeakMap<DenseSchema, Map<string, DenseField | undefined>>();

const findFieldByName = (fields: DenseField[], targetName: string, visited: Set<DenseField>): DenseField | undefined => {
  for (const field of fields) {
    if (visited.has(field)) continue; // Prevent infinite loops
    visited.add(field);

    if (field.name === targetName) return field;

    let found: DenseField | undefined;
    switch (field.type) {
      case 'object':
        found = findFieldByName(field.fields, targetName, visited);
        break;
      case 'union':
        for (const variantFields of Object.values(field.variants)) {
          found = findFieldByName(variantFields, targetName, visited);
          if (found) break;
        }
        break;
      case 'array':
        found = findFieldByName([field.items], targetName, visited);
        break;
      case 'optional':
        found = findFieldByName([field.field], targetName, visited);
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
    if (found) return found;
  }
  return undefined;
};

/**
 * Resolve the field a pointer's `targetName` refers to.
 *
 * Scoping: this is the first field with that name in a depth-first walk of the whole schema, in
 * declaration order. It is not lexically scoped: a pointer can bind to a field in a sibling union
 * variant or an unrelated object, and when two fields share the name the first one wins.
 * See https://github.com/JonasWard/densing/issues/13.
 */
export const resolveDenseFieldByName = (schema: DenseSchema, targetName: string): DenseField | undefined => {
  let targets = resolvedTargets.get(schema);
  if (!targets) resolvedTargets.set(schema, (targets = new Map()));
  if (!targets.has(targetName)) targets.set(targetName, findFieldByName(schema.fields, targetName, new Set()));
  return targets.get(targetName);
};

/**
 * Resolve a pointer's target, throwing the standard errors when there is no schema or no such field.
 */
export const resolvePointerOrThrow = (pointer: PointerField, schema: DenseSchema | undefined): DenseField => {
  if (!schema) throw new Error(`Pointer field "${pointer.name}" requires schema context`);
  const target = resolveDenseFieldByName(schema, pointer.targetName);
  if (!target) throw new Error(`Pointer field "${pointer.name}" references unknown field "${pointer.targetName}"`);
  return target;
};
