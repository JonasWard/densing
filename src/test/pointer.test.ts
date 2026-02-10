import { describe, test, expect } from 'bun:test';
import { schema, int, enumeration, union, pointer, object, array, optional, bool } from '../schema';
import { densing, undensing } from '../densing';

describe('Pointer Field Tests', () => {
  // Test 1: Simple self-referential structure (linked list)
  test('linked list with pointer', () => {
    const LinkedListSchema = schema(
      union('node', enumeration('type', ['value', 'next']), {
        value: [int('data', 0, 100)],
        next: [int('data', 0, 100), pointer('tail', 'node')]
      })
    );

    // List: 5 -> 10 -> 15
    const data = {
      node: {
        type: 'next',
        data: 5,
        tail: {
          type: 'next',
          data: 10,
          tail: {
            type: 'value',
            data: 15
          }
        }
      }
    };

    const encoded = densing(LinkedListSchema, data, 'base64url');
    const decoded = undensing(LinkedListSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Linked list encoded:', encoded);
  });

  // Test 2: Binary tree
  test('binary tree with pointers', () => {
    const BinaryTreeSchema = schema(
      union('tree', enumeration('type', ['leaf', 'branch']), {
        leaf: [int('value', 0, 255)],
        branch: [int('value', 0, 255), pointer('left', 'tree'), pointer('right', 'tree')]
      })
    );

    // Tree:
    //       10
    //      /  \
    //     5    15
    const data = {
      tree: {
        type: 'branch',
        value: 10,
        left: {
          type: 'leaf',
          value: 5
        },
        right: {
          type: 'leaf',
          value: 15
        }
      }
    };

    const encoded = densing(BinaryTreeSchema, data, 'base64url');
    const decoded = undensing(BinaryTreeSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Binary tree encoded:', encoded);
  });

  // Test 3: Expression AST (nested arithmetic)
  test('expression AST with pointers', () => {
    const ExpressionSchema = schema(
      union('expr', enumeration('type', ['number', 'add', 'multiply']), {
        number: [int('value', 0, 1000)],
        add: [pointer('left', 'expr'), pointer('right', 'expr')],
        multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
      })
    );

    // Expression: (5 + 3) * 2
    const data = {
      expr: {
        type: 'multiply',
        left: {
          type: 'add',
          left: {
            type: 'number',
            value: 5
          },
          right: {
            type: 'number',
            value: 3
          }
        },
        right: {
          type: 'number',
          value: 2
        }
      }
    };

    const encoded = densing(ExpressionSchema, data, 'base64url');
    const decoded = undensing(ExpressionSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Expression AST encoded:', encoded);
  });

  // Test 4: Pointer in array
  test('array of recursive structures', () => {
    const TreeSchema = schema(
      array(
        'forest',
        0,
        5,
        union('tree', enumeration('type', ['leaf', 'branch']), {
          leaf: [int('value', 0, 100)],
          branch: [int('value', 0, 100), pointer('left', 'tree'), pointer('right', 'tree')]
        })
      )
    );

    const data = {
      forest: [
        {
          type: 'leaf',
          value: 5
        },
        {
          type: 'branch',
          value: 10,
          left: {
            type: 'leaf',
            value: 3
          },
          right: {
            type: 'leaf',
            value: 7
          }
        }
      ]
    };

    const encoded = densing(TreeSchema, data, 'base64url');
    const decoded = undensing(TreeSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Array of trees encoded:', encoded);
  });

  // Test 5: Optional pointer
  test('optional recursive field', () => {
    const NodeSchema = schema(
      object('node', int('id', 0, 1000), optional('parent', pointer('parentNode', 'node'), null))
    );

    // Node with parent
    const dataWithParent = {
      node: {
        id: 42,
        parent: {
          id: 10,
          parent: null
        }
      }
    };

    const encoded1 = densing(NodeSchema, dataWithParent, 'base64url');
    const decoded1 = undensing(NodeSchema, encoded1, 'base64url');
    expect(decoded1).toEqual(dataWithParent);

    // Node without parent
    const dataWithoutParent = {
      node: {
        id: 42,
        parent: null
      }
    };

    const encoded2 = densing(NodeSchema, dataWithoutParent, 'base64url');
    const decoded2 = undensing(NodeSchema, encoded2, 'base64url');
    expect(decoded2).toEqual(dataWithoutParent);

    console.log('Node with parent:', encoded1);
    console.log('Node without parent:', encoded2);
  });

  // Test 6: Deep recursion
  test('deep recursive structure', () => {
    const ListSchema = schema(
      union('list', enumeration('type', ['empty', 'cons']), {
        empty: [],
        cons: [int('head', 0, 255), pointer('tail', 'list')]
      })
    );

    // List: [1, 2, 3, 4, 5]
    const data = {
      list: {
        type: 'cons',
        head: 1,
        tail: {
          type: 'cons',
          head: 2,
          tail: {
            type: 'cons',
            head: 3,
            tail: {
              type: 'cons',
              head: 4,
              tail: {
                type: 'cons',
                head: 5,
                tail: {
                  type: 'empty'
                }
              }
            }
          }
        }
      }
    };

    const encoded = densing(ListSchema, data, 'base64url');
    const decoded = undensing(ListSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Deep list encoded:', encoded, `(${encoded.length} chars)`);
  });

  // Test 7: Binary encoding for recursive structures
  test('binary encoding for recursive tree', () => {
    const TreeSchema = schema(
      union('tree', enumeration('type', ['leaf', 'node']), {
        leaf: [int('value', 0, 15)], // 4 bits
        node: [pointer('left', 'tree'), pointer('right', 'tree')]
      })
    );

    const data = {
      tree: {
        type: 'node',
        left: {
          type: 'leaf',
          value: 5
        },
        right: {
          type: 'leaf',
          value: 10
        }
      }
    };

    const encoded = densing(TreeSchema, data, 'binary');
    const decoded = undensing(TreeSchema, encoded, 'binary');

    expect(decoded).toEqual(data);
    console.log('Binary tree (binary):', encoded);
    // Expected: 1 bit (discriminator) + 1 bit (left discriminator) + 4 bits (left value) + 1 bit (right discriminator) + 4 bits (right value) = 11 bits
    expect(encoded.length).toBe(11);
  });

  // Test 8: Multiple pointer references in same structure
  test('graph-like structure with multiple pointers', () => {
    const GraphSchema = schema(
      object(
        'graph',
        int('id', 0, 100),
        bool('visited', false),
        array('neighbors', 0, 3, pointer('neighborNode', 'graph'))
      )
    );

    const data = {
      graph: {
        id: 1,
        visited: true,
        neighbors: [
          {
            id: 2,
            visited: false,
            neighbors: []
          },
          {
            id: 3,
            visited: false,
            neighbors: []
          }
        ]
      }
    };

    const encoded = densing(GraphSchema, data, 'base64url');
    const decoded = undensing(GraphSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('Graph structure encoded:', encoded);
  });

  // Test 9: Pointer to top-level union
  test('pointer references top-level union correctly', () => {
    const JsonSchema = schema(
      union('json', enumeration('type', ['null', 'bool', 'number', 'string', 'array', 'object']), {
        null: [],
        bool: [bool('value', false)],
        number: [int('value', -1000, 1000)],
        string: [enumeration('value', ['a', 'b', 'c'])],
        array: [array('items', 0, 5, pointer('item', 'json'))],
        object: []
      })
    );

    // JSON: [true, 42, "a"]
    const data = {
      json: {
        type: 'array',
        items: [
          {
            type: 'bool',
            value: true
          },
          {
            type: 'number',
            value: 42
          },
          {
            type: 'string',
            value: 'a'
          }
        ]
      }
    };

    const encoded = densing(JsonSchema, data, 'base64url');
    const decoded = undensing(JsonSchema, encoded, 'base64url');

    expect(decoded).toEqual(data);
    console.log('JSON-like structure:', encoded);
  });
});
