import { schema, int, createRecursiveUnion } from '../schema';
import { densing, undensing } from '../densing';

/**
 * Example 1: Mathematical Expression
 * Define the structure ONCE, reuse it recursively
 */
console.log('\n=== Example 1: Recursive Expression (Define ONCE) ===');

// Define the expression structure ONCE
const ExpressionSchema = schema(
  createRecursiveUnion(
    'expr',
    ['number', 'add', 'multiply', 'divide'],
    (recurse) => ({
      number: [int('value', 0, 1000)],
      add: [
        recurse('left'), // Left operand - automatically recursive
        recurse('right') // Right operand - automatically recursive
      ],
      multiply: [recurse('left'), recurse('right')],
      divide: [recurse('left'), recurse('right')]
    }),
    3 // Max depth of 3 levels
  )
);

// Test data: ((5 + 3) * 2) / 4 = 4
const expressionData = {
  expr: {
    type: 'divide',
    left: {
      type: 'multiply',
      left: {
        type: 'add',
        left: { type: 'number', value: 5 },
        right: { type: 'number', value: 3 }
      },
      right: { type: 'number', value: 2 }
    },
    right: { type: 'number', value: 4 }
  }
};

const encoded1 = densing(ExpressionSchema, expressionData);
const decoded1 = undensing(ExpressionSchema, encoded1);

console.log('Expression:', JSON.stringify(expressionData, null, 2));
console.log('Encoded:', encoded1, `(${encoded1.length} chars)`);
console.log('Match:', JSON.stringify(expressionData) === JSON.stringify(decoded1) ? '✓' : '✗');

/**
 * Example 2: Binary Tree with Any Value Type
 * Define ONCE with multiple value types
 */
console.log('\n=== Example 2: Recursive Binary Tree (Define ONCE) ===');

const BinaryTreeSchema = schema(
  createRecursiveUnion(
    'node',
    ['leaf', 'branch'],
    (recurse) => ({
      leaf: [int('value', 0, 100)],
      branch: [
        int('value', 0, 100),
        recurse('left'), // Left child - automatically recursive
        recurse('right') // Right child - automatically recursive
      ]
    }),
    3 // Max depth of 3 levels
  )
);

const treeData = {
  node: {
    type: 'branch',
    value: 10,
    left: {
      type: 'branch',
      value: 5,
      left: { type: 'leaf', value: 2 },
      right: { type: 'leaf', value: 7 }
    },
    right: {
      type: 'branch',
      value: 15,
      left: { type: 'leaf', value: 12 },
      right: { type: 'leaf', value: 20 }
    }
  }
};

const encoded2 = densing(BinaryTreeSchema, treeData);
const decoded2 = undensing(BinaryTreeSchema, encoded2);

console.log('Tree:', JSON.stringify(treeData, null, 2));
console.log('Encoded:', encoded2, `(${encoded2.length} chars)`);
console.log('Match:', JSON.stringify(treeData) === JSON.stringify(decoded2) ? '✓' : '✗');

console.log('\n=== Your Use Case: Method with Inputs ===');
console.log(`
// Here's how you define it ONCE for your use case:

const MethodSchema = schema(
  createRecursiveUnion(
    'method',
    ['int_value', 'fixed_value', 'operation'],
    (recurse) => ({
      // Terminal case: just a value
      int_value: [int('value', 0, 1000)],
      fixed_value: [fixed('value', -100, 100, 0.1)],
      
      // Recursive case: operation with inputs
      // Each input can be EITHER int_value, fixed_value, OR another operation!
      operation: [
        enumeration('op', ['add', 'multiply', 'subtract']),
        recurse('left'),   // Can be any of the 3 types
        recurse('right')   // Can be any of the 3 types
      ]
    }),
    4 // Max recursion depth
  )
);

// Usage - you only defined the structure ONCE above!
// Now you can nest operations freely:
{
  method: {
    type: 'operation',
    op: 0, // add
    left: {
      type: 'operation',
      op: 1, // multiply
      left: { type: 'int_value', value: 5 },
      right: { type: 'fixed_value', value: 3.5 }
    },
    right: { type: 'int_value', value: 10 }
  }
}

Result: (5 * 3.5) + 10 = 27.5
`);

console.log('\n=== Space Efficiency ===');
console.log(`Expression JSON: ${JSON.stringify(expressionData).length} bytes -> Base64: ${encoded1.length} chars`);
console.log(`Tree JSON: ${JSON.stringify(treeData).length} bytes -> Base64: ${encoded2.length} chars`);

console.log('\n=== Key Benefits ===');
console.log('✓ Define the recursive structure ONCE');
console.log('✓ Automatically expands to your max depth');
console.log('✓ No manual nesting required!');
console.log('✓ Clean, maintainable code');
console.log('✓ Easy to change - just modify one place');
