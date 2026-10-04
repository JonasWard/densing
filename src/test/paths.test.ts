import { describe, expect, test } from 'bun:test';
import { getAllDenseSchemaPaths, getFieldByPath, walkDenseSchema } from '../api';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, schema, union } from '../schema/builder';
import { DenseField, DenseSchema } from '../schema-type';
import { GLSLRayMarchingSchema } from './glsl-ray-marching.test';

const S = schema(
  int('id', 0, 10),
  optional('maybe', object('inner', int('x', 0, 3))),
  array('users', 0, 3, object('user', int('uid', 0, 99), bool('active'))),
  array('scores', 0, 3, int('score', 0, 9)),
  enumArray('tags', enumeration('tag', ['a', 'b']), 0, 3),
  union('action', enumeration('type', ['start', 'stop']), {
    start: [int('delay', 0, 9), object('opts', fixed('speed', 0, 1, 0.1))],
    stop: [bool('force')]
  }),
  union('expr', enumeration('kind', ['number', 'add']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')]
  })
);

describe('getFieldByPath understands every path the walk produces', () => {
  const schemas: [string, DenseSchema][] = [
    ['mixed', S],
    ['glsl ray marching', GLSLRayMarchingSchema]
  ];

  for (const [name, schemaUnderTest] of schemas) {
    test(name, () => {
      const visited: [DenseField, string][] = [];
      walkDenseSchema(schemaUnderTest, (field, path) => visited.push([field, path]));
      expect(visited.length).toBe(getAllDenseSchemaPaths(schemaUnderTest).length);

      for (const [field, path] of visited) {
        const found = getFieldByPath(schemaUnderTest, path);
        // a path shared by same-named fields of different union variants resolves to the first one
        const firstWithPath = visited.find(([, p]) => p === path)![0];
        expect({ path, found: found === firstWithPath }).toEqual({ path, found: true });
        expect(found!.name).toBe(field.name);
      }
    });
  }
});

describe('path grammar', () => {
  const at = (path: string) => getFieldByPath(S, path);

  test('objects, optionals, arrays and unions', () => {
    expect(at('maybe')?.type).toBe('optional');
    expect(at('maybe.inner')?.type).toBe('object');
    expect(at('maybe.inner.x')?.type).toBe('int');
    expect(at('users[].user')?.type).toBe('object');
    expect(at('users[].user.uid')?.name).toBe('uid');
    expect(at('scores[].score')?.type).toBe('int');
    expect(at('action.type')?.type).toBe('enum');
    expect(at('action.delay')?.name).toBe('delay');
    expect(at('action.opts.speed')?.type).toBe('fixed');
    expect(at('action.force')?.type).toBe('bool');
  });

  test('pointers continue in their target', () => {
    expect(at('expr.left')?.type).toBe('pointer');
    expect(at('expr.left.value')?.name).toBe('value');
    expect(at('expr.left.right.left.kind')?.type).toBe('enum');
  });

  test('legacy: `list.child` still finds a field of object items', () => {
    expect(at('users.uid')?.name).toBe('uid');
  });

  test('paths that do not exist return null', () => {
    for (const path of ['nope', 'id.x', 'id[]', 'tags[].tag', 'maybe.x', 'users[].uid', 'action.start', 'expr.left.nope', ''])
      expect({ path, field: at(path) }).toEqual({ path, field: null });
  });
});

test('walkDenseSchema passes the parent field', () => {
  const parents: Record<string, string | undefined> = {};
  walkDenseSchema(S, (field, path, parent) => (parents[path] = parent?.name));
  expect(parents['id']).toBeUndefined();
  expect(parents['maybe.inner']).toBe('maybe');
  expect(parents['users[].user']).toBe('users');
  expect(parents['users[].user.uid']).toBe('user');
  expect(parents['action.type']).toBe('action');
  expect(parents['action.delay']).toBe('action');
});
