import { DenseSchema, DenseField, ObjectField, UnionField, assertNeverDenseField } from '../schema-type';
import { PRESETS_KEY, presetNames, resolveTemplateOrThrow, schemaDefinitions } from './definitions';
import { resolvePointerOrThrow } from './resolve';

/**
 * Global TypeScript types a generated type must not shadow: code that imports the generated types
 * would lose them
 */
const RESERVED_TYPE_NAMES = new Set([
  'Array',
  'ArrayLike',
  'Awaited',
  'BigInt',
  'Boolean',
  'Capitalize',
  'Date',
  'Error',
  'Exclude',
  'Extract',
  'Function',
  'InstanceType',
  'Iterable',
  'Iterator',
  'JSON',
  'Lowercase',
  'Map',
  'Math',
  'NoInfer',
  'NonNullable',
  'Number',
  'Object',
  'Omit',
  'Parameters',
  'Partial',
  'Pick',
  'Promise',
  'PropertyKey',
  'Readonly',
  'ReadonlyArray',
  'Record',
  'RegExp',
  'Required',
  'ReturnType',
  'Set',
  'String',
  'Symbol',
  'ThisType',
  'Uncapitalize',
  'Uppercase',
  'WeakMap',
  'WeakSet'
]);

/** State of one `generateTypes` call */
type Context = {
  schema: DenseSchema;
  /** the declarations so far, dependencies before the types that use them */
  types: string[];
  /** every type name in use */
  usedNames: Set<string>;
  /** the type name of each named shape, keyed by `shapeKey` */
  shapeNames: Map<string, string>;
  /** `shapeKey` of each field, computed once */
  shapeKeys: WeakMap<DenseField, string>;
};

/**
 * Generate TypeScript type definitions from a schema. Objects, unions and templates each get a named
 * type, named after the field (`Settings`) or, for union variants, the union and the option
 * (`Shape_Circle`). Names are made valid identifiers, and fields with the same name but a different
 * shape get distinct names (`Fields`, `Fields2`).
 */
export const generateTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): string => {
  const ctx: Context = {
    schema,
    types: [],
    usedNames: new Set([rootTypeName]),
    shapeNames: new Map(),
    shapeKeys: new WeakMap()
  };

  // Generate the root type, starting with the presets of the numeric definitions
  const definitions = schemaDefinitions(schema);
  const presetsField = definitions.length
    ? [
        `  ${propertyKey(PRESETS_KEY)}?: {\n${definitions
          .map((d) => `    ${propertyKey(d.name)}?: ${presetNames(d).map(stringLiteral).join(' | ')};`)
          .join('\n')}\n  };`
      ]
    : [];
  const rootFields = [...presetsField, ...schema.fields.map((field) => property(field, ctx))].join('\n');

  const rootType = `export interface ${rootTypeName} {\n${rootFields}\n}`;

  // Return all generated types with the root type at the end
  return [...ctx.types, rootType].join('\n\n');
};

/** `  name: Type;` */
const property = (field: DenseField, ctx: Context): string =>
  `  ${propertyKey(field.name)}: ${getFieldType(field, ctx)};`;

/**
 * Get the TypeScript type for a field
 */
const getFieldType = (field: DenseField, ctx: Context): string => {
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

    case 'array':
      return `${getFieldType(field.items, ctx)}[]`;

    case 'optional':
      return `${getFieldType(field.field, ctx)} | null`;

    case 'object':
    case 'union':
      return namedShape(field, ctx);

    case 'pointer':
      // a pointer has the type of its target, which is named so that recursive targets terminate
      return namedTarget(resolvePointerOrThrow(field, ctx.schema), ctx);

    case 'reference':
      // every template is a named type; objects and unions name themselves, the rest get an alias
      return namedTarget(resolveTemplateOrThrow(field, ctx.schema), ctx);

    default:
      return assertNeverDenseField(field);
  }
};

/** The type name of a template or pointer target */
const namedTarget = (target: DenseField, ctx: Context): string => {
  if (target.type === 'object' || target.type === 'union') return namedShape(target, ctx);
  const key = `alias:${shapeKey(target, ctx)}`;
  const known = ctx.shapeNames.get(key);
  if (known) return known;
  const typeName = uniqueTypeName(target.name, ctx);
  ctx.shapeNames.set(key, typeName); // before recursing, so a target that refers to itself terminates
  ctx.types.push(`export type ${typeName} = ${getFieldType(target, ctx)};`);
  return typeName;
};

/** The type name of an object or union, declaring the type the first time the shape is seen */
const namedShape = (field: ObjectField | UnionField, ctx: Context): string => {
  const key = shapeKey(field, ctx);
  const known = ctx.shapeNames.get(key);
  if (known) return known;

  const typeName = uniqueTypeName(field.name, ctx);
  ctx.shapeNames.set(key, typeName); // before recursing, so a shape that contains itself terminates

  if (field.type === 'object') {
    const objectFields = field.fields.map((f) => property(f, ctx)).join('\n');
    ctx.types.push(`export interface ${typeName} {\n${objectFields}\n}`);
    return typeName;
  }

  // name the variants before generating their fields, so nested types cannot take their names
  const options = field.discriminator.options;
  const variantNames = options.map((option) => uniqueTypeName(`${typeName}_${capitalize(identifier(option))}`, ctx));
  options.forEach((option, i) => {
    const variantFields = field.variants[option] || [];
    const fields = [
      `  ${propertyKey(field.discriminator.name)}: ${stringLiteral(option)};`,
      ...variantFields.map((f) => property(f, ctx))
    ].join('\n');
    ctx.types.push(`export interface ${variantNames[i]} {\n${fields}\n}`);
  });
  ctx.types.push(`export type ${typeName} = ${variantNames.join(' | ')};`);
  return typeName;
};

/** Fields with the same key have the same TypeScript type (references are template indices) */
const shapeKey = (field: DenseField, ctx: Context): string => {
  let key = ctx.shapeKeys.get(field);
  if (key === undefined) {
    key = JSON.stringify(field);
    ctx.shapeKeys.set(field, key);
  }
  return key;
};

/** A type name based on `name` that is a valid identifier, not a global type, and not yet used */
const uniqueTypeName = (name: string, ctx: Context): string => {
  let base = capitalize(identifier(name));
  if (RESERVED_TYPE_NAMES.has(base)) base += 'Type';
  let typeName = base;
  for (let i = 2; ctx.usedNames.has(typeName); i++) typeName = `${base}${i}`;
  ctx.usedNames.add(typeName);
  return typeName;
};

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

/** `name` as an identifier: characters that cannot appear in one split it into capitalized words */
const identifier = (name: string): string => {
  if (IDENTIFIER.test(name)) return name;
  const words = name.split(/[^\p{ID_Continue}$]+/u).filter(Boolean);
  const joined = words.map((word, i) => (i === 0 ? word : capitalize(word))).join('');
  if (!joined) return 'Type';
  return IDENTIFIER.test(joined) ? joined : `_${joined}`;
};

/** An object key: bare when it is an identifier, quoted otherwise */
const propertyKey = (name: string): string => (IDENTIFIER.test(name) ? name : stringLiteral(name));

/** A single quoted TypeScript string literal */
const stringLiteral = (value: string): string =>
  `'${value.replace(/[\\'\n\r\u2028\u2029]/g, (c) => STRING_ESCAPES[c])}'`;

const STRING_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};

/**
 * Capitalize the first letter of a string
 */
const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Generate types and write to console (for convenience)
 */
export const printTypes = (schema: DenseSchema, rootTypeName: string = 'SchemaData'): void => {
  console.log(generateTypes(schema, rootTypeName));
};
