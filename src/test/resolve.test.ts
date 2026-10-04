import { expect, test } from 'bun:test';
import { resolveDenseFieldByName, resolvePointerOrThrow } from '../schema/resolve';
import { array, enumeration, int, object, optional, pointer, schema, union } from '../schema/builder';

test('resolves targets inside objects, unions, arrays and optionals', () => {
  const inner = int('deep', 0, 3);
  const S = schema(
    object('o', union('u', enumeration('t', ['a', 'b']), { a: [], b: [array('arr', 0, 2, optional('opt', inner))] }))
  );
  expect(resolveDenseFieldByName(S, 'deep')).toBe(inner);
  expect(resolveDenseFieldByName(S, 'u')?.type).toBe('union');
  expect(resolveDenseFieldByName(S, 'missing')).toBeUndefined();
});

test('first match in depth-first declaration order wins (no lexical scoping, see #13)', () => {
  const first = int('v', 0, 1);
  const S = schema(object('a', first), object('b', int('v', 0, 100)));
  expect(resolveDenseFieldByName(S, 'v')).toBe(first);
});

test('resolvePointerOrThrow reports missing schema and unknown targets', () => {
  const p = pointer('p', 'nope');
  expect(() => resolvePointerOrThrow(p, undefined)).toThrow('Pointer field "p" requires schema context');
  expect(() => resolvePointerOrThrow(p, { fields: [p] })).toThrow('Pointer field "p" references unknown field "nope"');
});
