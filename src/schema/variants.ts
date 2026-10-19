// variants.ts - resolving a union's variants to their object templates
import { DenseField, DenseSchema, EnumField, ObjectField, UnionField } from '../schema-type';

/**
 * The variant templates of a union built by `union()`, before `schema()` gives them their indices:
 * so that a union can also be used on its own (validating a default value, measuring a field).
 */
const variantLinks = new WeakMap<UnionField, Record<string, DenseField | (() => DenseField)>>();

export const linkVariants = (field: UnionField, links: Record<string, DenseField | (() => DenseField)>): void => {
  variantLinks.set(field, links);
};

/** The links of a union that `schema()` has not bound yet */
export const variantLinksOf = (field: UnionField): Record<string, DenseField | (() => DenseField)> | undefined =>
  variantLinks.get(field);

const namesCache = new WeakMap<UnionField, string[]>();

/** The variant names, in the order of their encoded index */
export const variantNames = (field: UnionField): string[] => {
  let names = namesCache.get(field);
  if (!names) namesCache.set(field, (names = Object.keys(field.variants)));
  return names;
};

/** The variant of the default data */
export const defaultVariant = (field: UnionField): string => field.defaultVariant ?? variantNames(field)[0];

const discriminators = new WeakMap<UnionField, EnumField>();

/** The discriminator as an enum field (its options are the variant names), for walking and paths */
export const discriminatorField = (field: UnionField): EnumField => {
  let enumField = discriminators.get(field);
  if (!enumField) {
    const options = variantNames(field);
    enumField = { type: 'enum', name: field.discriminator, options, defaultValue: defaultVariant(field) };
    discriminators.set(field, enumField);
  }
  return enumField;
};

/**
 * The template of a variant: through the union's links before `schema()`, through `templates` after
 * @throws when the variant does not exist or its template cannot be found
 */
export const variantTemplate = (field: UnionField, key: string, schema: DenseSchema | undefined): DenseField => {
  const link = variantLinks.get(field)?.[key];
  const linked = typeof link === 'function' ? link() : link;
  if (linked) return linked;
  const index = field.variants[key];
  if (index === undefined) throw new Error(`union "${field.name}": no variant "${key}"`);
  if (!schema) throw new Error(`union "${field.name}" requires schema context`);
  const template = schema.templates?.[index];
  if (!template) throw new Error(`union "${field.name}" variant "${key}": template ${index} does not exist`);
  return template;
};

/**
 * The object template of a variant, following templates that are references to other templates
 * @throws when the template is not an object
 */
export const variantObject = (field: UnionField, key: string, schema: DenseSchema | undefined): ObjectField => {
  let template = variantTemplate(field, key, schema);
  for (let depth = 0; template.type === 'reference' && depth < 64; depth++) {
    const next = schema?.templates?.[template.ref];
    if (!next) break;
    template = next;
  }
  if (template.type !== 'object')
    throw new Error(`union "${field.name}" variant "${key}": the template must be an object, got "${template.type}"`);
  return template;
};
