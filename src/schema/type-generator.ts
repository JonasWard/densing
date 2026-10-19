import { DenseSchema, DenseField, assertNeverDenseField } from '../schema-type';
import { PRESETS_KEY, presetNames, resolveTemplateOrThrow, schemaDefinitions } from './definitions';
import { variantNames, variantObject } from './variants';

/**
 * Generate TypeScript type definitions from a schema. Objects, unions and templates get a named type, named after the field (union variants: `Union_Option`). Fields of the same shape
 * share a type; a name that is already taken by another shape gets a number (`Fields2`).
 */
export const generateTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): string => {
  const declarations: string[] = [];
  const usedNames = new Set([rootTypeName]);
  const shapeNames = new Map<string, string>(); // JSON of a field -> its type name

  const uniqueName = (name: string): string => {
    const base = capitalize(identifier(name));
    let typeName = base;
    for (let i = 2; usedNames.has(typeName); i++) typeName = `${base}${i}`;
    usedNames.add(typeName);
    return typeName;
  };

  const property = (field: DenseField): string => `  ${propertyKey(field.name)}: ${typeOf(field)};`;

  /** The type name of `field`, declared the first time its shape is seen */
  const named = (field: DenseField): string => {
    const shape = JSON.stringify(field);
    const known = shapeNames.get(shape);
    if (known) return known;
    const typeName = uniqueName(field.name);
    shapeNames.set(shape, typeName); // before declaring, so a recursive shape refers to its own name
    declarations.push(...declare(field, typeName));
    return typeName;
  };

  const declare = (field: DenseField, typeName: string): string[] => {
    if (field.type === 'object')
      return [`export interface ${typeName} {\n${field.fields.map(property).join('\n')}\n}`];
    if (field.type !== 'union') return [`export type ${typeName} = ${typeOf(field)};`];

    // name the variants before their fields, so nested types cannot take their names
    const options = variantNames(field);
    const typeNames = options.map((option) => uniqueName(`${typeName}_${capitalize(identifier(option))}`));
    return [
      ...options.map((option, i) => {
        const tag = `  ${propertyKey(field.discriminator)}: ${stringLiteral(option)};`;
        const fields = variantObject(field, option, schema).fields.map(property);
        return `export interface ${typeNames[i]} {\n${[tag, ...fields].join('\n')}\n}`;
      }),
      `export type ${typeName} = ${typeNames.join(' | ')};`
    ];
  };

  const typeOf = (field: DenseField): string => {
    switch (field.type) {
      case 'bool':
        return 'boolean';
      case 'int':
      case 'fixed':
      case 'reference_numeric':
        return 'number';
      case 'enum':
        return field.options.map(stringLiteral).join(' | ');
      case 'enum_array':
        return `(${field.enum.options.map(stringLiteral).join(' | ')})[]`;
      case 'array': {
        const itemType = typeOf(field.items);
        return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
      }
      case 'optional':
        return `${typeOf(field.field)} | null`;
      case 'object':
      case 'union':
        return named(field);
      case 'reference':
        return named(resolveTemplateOrThrow(field, schema));
      default:
        return assertNeverDenseField(field);
    }
  };

  // the root type, starting with the presets of the numeric definitions
  const definitions = schemaDefinitions(schema);
  const presets = definitions.length
    ? [
        `  ${PRESETS_KEY}?: {\n${definitions
          .map((d) => `    ${propertyKey(d.name)}?: ${presetNames(d).map(stringLiteral).join(' | ')};`)
          .join('\n')}\n  };`
      ]
    : [];
  const rootFields = [...presets, ...schema.fields.map(property)].join('\n');

  return [...declarations, `export interface ${rootTypeName} {\n${rootFields}\n}`].join('\n\n');
};

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u;

/** `name` as an identifier: the characters that cannot be in one split it into capitalized words */
const identifier = (name: string): string => {
  if (IDENTIFIER.test(name)) return name;
  const words = name.split(/[^\p{ID_Continue}$]+/u).filter(Boolean);
  const joined = words.map((word, i) => (i ? capitalize(word) : word)).join('') || 'Type';
  return IDENTIFIER.test(joined) ? joined : `_${joined}`;
};

/** An object key: bare when it is an identifier, quoted otherwise */
const propertyKey = (name: string): string => (IDENTIFIER.test(name) ? name : stringLiteral(name));

const ESCAPES: Record<string, string> = { '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r' };

/** A single quoted string literal */
const stringLiteral = (value: string): string => `'${value.replace(/[\\'\n\r]/g, (c) => ESCAPES[c])}'`;

const capitalize = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Generate types and write to console (for convenience)
 */
export const printTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): void => {
  console.log(generateTypes(schema, rootTypeName));
};
