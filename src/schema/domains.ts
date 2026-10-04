// domains.ts - named numeric ranges that a schema defines once and that the data chooses between
import { FixedPointField, IntField, UnionField } from '../schema-type';
import { enumeration, fixed, int, union } from './builder';

/**
 * A named numeric domain: a range and a precision. A precision of `1` makes the attributes integers.
 * A domain is a reusable type, not a field: `field(name)` makes a field in this domain, and `domains`
 * lets the data choose between several of them.
 */
export interface NumericDomain {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly precision: number;
  readonly defaultValue: number;
  /** A field named `name` that holds a value in this domain */
  field: (name: string) => IntField | FixedPointField;
}

/**
 * Define a numeric domain
 * @param name - identifies the domain in the data (`{ domain: 'fine', x: 1.25 }`)
 * @param precision - step between values; `1` (the default) means integers, `0.01` two decimals
 * @param defaultValue - default for attributes in this domain, `min` when omitted
 * @example domain('fine', -10, 10, 0.01) // 2001 values, 11 bits
 */
export const domain = (
  name: string,
  min: number,
  max: number,
  precision: number = 1,
  defaultValue?: number
): NumericDomain => {
  const field = (fieldName: string): IntField | FixedPointField =>
    precision === 1 ? int(fieldName, min, max, defaultValue) : fixed(fieldName, min, max, precision, defaultValue);
  // build one field now so an invalid domain throws where it is defined
  const { defaultValue: resolvedDefault } = field(name);
  return { name, min, max, precision, defaultValue: resolvedDefault, field };
};

export interface DomainsOptions {
  /** Name of the key in the data that holds the chosen domain (default `'domain'`) */
  key?: string;
  /** Domain used by `getDefaultData` (default: the first acceptable domain) */
  defaultDomain?: string;
}

/**
 * A group of numeric attributes that share one domain, chosen in the data from the acceptable ones
 * the schema lists. The domain costs `ceil(log2(acceptable.length))` bits, then every attribute uses
 * that domain's width.
 *
 * It is a `union` over the domain names, so the data looks like `{ domain: 'fine', x: 1.25, y: -3.5 }`
 * and everything that works on unions (validation, size analysis, paths, type generation) works here.
 *
 * @example
 * const fine = domain('fine', -10, 10, 0.01);
 * const count = domain('count', 0, 1000);
 * const wide = domain('wide', -1000, 1000, 0.001);
 * schema(domains('vec2', ['x', 'y'], [fine, count, wide]));
 * // { vec2: { domain: 'count', x: 12, y: 999 } } → 2 + 10 + 10 bits
 */
export const domains = (
  name: string,
  attributes: readonly string[],
  acceptable: readonly NumericDomain[],
  { key = 'domain', defaultDomain }: DomainsOptions = {}
): UnionField => {
  if (attributes.length === 0) throw new Error(`domains "${name}": needs at least one attribute`);
  if (acceptable.length < 2)
    throw new Error(`domains "${name}": needs at least 2 acceptable domains; use \`domain.field(name)\` for one`);

  const names = acceptable.map((d) => d.name);
  const discriminator = enumeration(key, names, defaultDomain ?? names[0]);
  const variants = Object.fromEntries(acceptable.map((d) => [d.name, attributes.map((a) => d.field(a))]));
  return union(name, discriminator, variants);
};
