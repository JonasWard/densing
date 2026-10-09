// migrate.ts - turn deprecated pointer schemas into template schemas
import { DenseField, DenseSchema, PointerField, ReferenceField } from '../schema-type';
import { schemaFromParts } from './builder';
import { resolveDenseFieldByName } from './resolve';
import { validateSchema } from './validate-schema';

const pointersIn = (field: DenseField, out: PointerField[]): PointerField[] => {
  switch (field.type) {
    case 'pointer':
      out.push(field);
      break;
    case 'object':
      field.fields.forEach((f) => pointersIn(f, out));
      break;
    case 'array':
      pointersIn(field.items, out);
      break;
    case 'optional':
      pointersIn(field.field, out);
      break;
    case 'union':
      Object.values(field.variants).forEach((fields) => fields.forEach((f) => pointersIn(f, out)));
      break;
    default:
      break;
  }
  return out;
};

/**
 * The same schema without `pointer` fields: every field a pointer refers to becomes a template, and
 * that field and every pointer to it become `reference` fields. The data and the encoded payloads
 * stay exactly the same (a reference is encoded as its template, like a pointer as its target).
 *
 * A schema without pointers is returned unchanged, as is one whose pointers `validateSchema`
 * rejects (missing, ambiguous or infinite targets).
 */
export const pointersToTemplates = (schema: DenseSchema): DenseSchema => {
  const existing = schema.templates ?? [];
  const pointers = [...existing, ...schema.fields].flatMap((f) => pointersIn(f, []));
  if (!pointers.length || !validateSchema(schema).valid) return schema;

  // a pointer may point at another pointer: follow the chain to the field that has the shape
  // (validateSchema guarantees the chain ends)
  const resolve = (targetName: string): DenseField => {
    const target = resolveDenseFieldByName(schema, targetName);
    if (!target) throw new Error(`pointersToTemplates: pointer target "${targetName}" does not exist`);
    return target;
  };
  const finalTarget = (pointer: PointerField): DenseField => {
    let target = resolve(pointer.targetName);
    while (target.type === 'pointer') target = resolve(target.targetName);
    return target;
  };
  const targets = new Set(pointers.map(finalTarget));
  const templates: DenseField[] = [...existing];
  const indices = new Map<DenseField, number>();
  const usedNames = new Set(existing.map((t) => t.name));

  const indexOf = (target: DenseField): number => {
    let index = indices.get(target);
    if (index === undefined) {
      index = templates.length;
      indices.set(target, index);
      templates.push(target); // placeholder, so a target that contains itself finds its index
      // template names must be unique; the name only matters for `generateTypes`
      let name = target.name;
      for (let i = 2; usedNames.has(name); i++) name = `${target.name}${i}`;
      usedNames.add(name);
      templates[index] = { ...rewriteInside(target), name } as DenseField;
    }
    return index;
  };

  const reference = (name: string, ref: number): ReferenceField => ({ type: 'reference', name, ref });

  /** The field with every pointer and pointer target below it replaced by references */
  const rewriteInside = (field: DenseField): DenseField => {
    switch (field.type) {
      case 'object':
        return { ...field, fields: field.fields.map(rewrite) };
      case 'array':
        return { ...field, items: rewrite(field.items) };
      case 'optional':
        return { ...field, field: rewrite(field.field) };
      case 'union':
        return {
          ...field,
          variants: Object.fromEntries(Object.entries(field.variants).map(([key, fields]) => [key, fields.map(rewrite)]))
        };
      default:
        return field;
    }
  };

  const rewrite = (field: DenseField): DenseField => {
    if (field.type === 'pointer') return reference(field.name, indexOf(finalTarget(field)));
    if (targets.has(field)) return reference(field.name, indexOf(field));
    return rewriteInside(field);
  };

  // existing templates first, so their indices stay; new templates follow in order of first use
  existing.forEach((t, i) => (templates[i] = rewriteInside(t)));
  const fields = schema.fields.map(rewrite);
  return schemaFromParts({ definitions: schema.definitions, templates }, fields);
};
