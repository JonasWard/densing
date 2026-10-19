// migrate.ts - turn schemas with `pointer` fields (removed in 0.5.0) into template schemas, as JSON

type Json = Record<string, any>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields one level below a field; 0.4 unions list their variants' fields, 0.5 unions refer to templates */
const children = (field: Json): Json[] => {
  switch (field.type) {
    case 'object':
      return Array.isArray(field.fields) ? field.fields : [];
    case 'array':
      return isObject(field.items) ? [field.items] : [];
    case 'optional':
      return isObject(field.field) ? [field.field] : [];
    case 'union':
      return isObject(field.variants)
        ? Object.values(field.variants).flatMap((variant) => (Array.isArray(variant) ? variant : []))
        : [];
    default:
      return [];
  }
};

const walk = (fields: Json[], visit: (field: Json) => void) => {
  for (const field of fields) {
    if (!isObject(field)) continue;
    visit(field);
    walk(children(field), visit);
  }
};

/**
 * Convert a schema that still has `pointer` fields (removed in 0.5.0): every field a pointer refers to
 * becomes a template, and that field and every pointer to it become `reference` fields. The data and
 * the encoded payloads stay exactly the same (a reference is encoded as its template, like a pointer
 * as its target).
 *
 * Works on the schema's JSON (as written by 0.4.x), since 0.5.0 cannot load a schema with pointers;
 * load the result with `schemaFromJson`. A schema without pointers is returned unchanged.
 * @param input - the schema as JSON string or parsed object
 * @throws when a pointer target does not exist or is ambiguous (several fields have its name)
 */
export const pointersToTemplates = (input: unknown): Json => {
  const json = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isObject(json) || !Array.isArray(json.fields)) throw new Error('pointersToTemplates: expected a schema with a "fields" array');
  const existing: Json[] = Array.isArray(json.templates) ? json.templates : [];

  const pointers: Json[] = [];
  walk([...existing, ...json.fields], (field) => field.type === 'pointer' && pointers.push(field));
  if (!pointers.length) return json;

  // pointer targets: any field outside the templates, found by its (unique) name
  const byName = new Map<string, Json[]>();
  walk(json.fields, (field) => byName.set(field.name, [...(byName.get(field.name) ?? []), field]));
  const resolve = (targetName: string): Json => {
    const found = byName.get(targetName) ?? [];
    if (!found.length) throw new Error(`pointersToTemplates: pointer target "${targetName}" does not exist`);
    if (found.length > 1) throw new Error(`pointersToTemplates: pointer target "${targetName}" is ambiguous`);
    return found[0];
  };
  // a pointer may point at another pointer: follow the chain to the field that has the shape
  const finalTarget = (pointer: Json): Json => {
    const seen = new Set<Json>();
    let target = resolve(pointer.targetName);
    while (target.type === 'pointer') {
      if (seen.has(target)) throw new Error(`pointersToTemplates: pointer "${pointer.name}" points at itself`);
      seen.add(target);
      target = resolve(target.targetName);
    }
    return target;
  };
  const targets = new Set(pointers.map(finalTarget));

  const templates: Json[] = [...existing];
  const indices = new Map<Json, number>();
  const usedNames = new Set(existing.map((t) => t.name));
  const indexOf = (target: Json): number => {
    let index = indices.get(target);
    if (index === undefined) {
      index = templates.length;
      indices.set(target, index);
      templates.push(target); // placeholder, so a target that contains itself finds its index
      // template names must be unique; the name only matters for `generateTypes`
      let name = target.name;
      for (let i = 2; usedNames.has(name); i++) name = `${target.name}${i}`;
      usedNames.add(name);
      templates[index] = { ...rewriteInside(target), name };
    }
    return index;
  };

  const reference = (name: string, ref: number): Json => ({ type: 'reference', name, ref });

  /** The field with every pointer and pointer target below it replaced by references */
  const rewriteInside = (field: Json): Json => {
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
          variants: Object.fromEntries(
            Object.entries(field.variants).map(([key, variant]) => [key, Array.isArray(variant) ? variant.map(rewrite) : variant])
          )
        };
      default:
        return field;
    }
  };

  const rewrite = (field: Json): Json => {
    if (field.type === 'pointer') return reference(field.name, indexOf(finalTarget(field)));
    if (targets.has(field)) return reference(field.name, indexOf(field));
    return rewriteInside(field);
  };

  // existing templates first, so their indices stay; new templates follow in order of first use
  existing.forEach((t, i) => (templates[i] = rewriteInside(t)));
  const fields = json.fields.map(rewrite);
  return { ...json, templates, fields };
};
