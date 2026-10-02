/**
 * Automated Test Runner for js-to-rust
 */

import { transpile } from '../src/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n--- Running js-to-rust Test Suite ---\n');

// Test 1: Simple arithmetic
{
  const js = `
  function add(a, b) {
    return a + b;
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn add(a: i64, b: i64) -> i64'), 'Translates basic function with default types');
  assert(rust.includes('return a + b;'), 'Translates arithmetic expression');
}

// Test 2: JSDoc type mapping
{
  const js = `
  /**
   * @param {float} x
   * @param {float} y
   * @returns {float}
   */
  function multiply(x, y) {
    return x * y;
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn multiply(x: f64, y: f64) -> f64'), 'Correctly maps JSDoc float to f64');
}

// Test 3: For loop range mapping
{
  const js = `
  function countTo(n) {
    for (let i = 0; i < n; i++) {
      console.log(i);
    }
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('for i in 0..n'), 'Converts standard for-loop to Rust range 0..n');
  assert(rust.includes('println!("{:?}", i)'), 'Converts console.log to println!');
}

// Test 4: Array slicing and auto-borrowing
{
  const js = `
  /**
   * @param {int[]} items
   * @returns {int}
   */
  function firstItem(items) {
    return items[0];
  }

  function main() {
    const list = [1, 2, 3];
    firstItem(list);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn firstItem(items: &[i64]) -> i64'), 'Translates int[] to &[i64]');
  assert(rust.includes('items[0 as usize]'), 'Casts array index to usize');
  assert(rust.includes('firstItem(&list)'), 'Auto-borrows &list when passing vector to slice');
}

// Test 5: Auto-detection of mutable borrowing (&mut)
{
  const js = `
  /**
   * @param {int[]} arr
   */
  function modifyArr(arr) {
    arr[0] = 999;
  }

  function main() {
    let nums = [1, 2, 3];
    modifyArr(nums);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn modifyArr(arr: &mut [i64])'), 'Auto-detects mutation and infers &mut [i64]');
  assert(rust.includes('modifyArr(&mut nums)'), 'Auto-passes &mut nums at call site');
}

// Test 6: Pattern Matching (Switch -> Rust Match)
{
  const js = `
  function handleCode(code) {
    switch (code) {
      case 200:
        return "OK";
      default:
        return "ERROR";
    }
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('match code {'), 'Translates switch to Rust match expression');
  assert(rust.includes('200 => {'), 'Generates match arm');
  assert(rust.includes('_ => {'), 'Generates default match arm');
}

// Test 7: Struct Definition & Instantiation
{
  const js = `
  /**
   * @typedef {Object} Vector2D
   * @property {float} x
   * @property {float} y
   */

  function getLength(v) {
    return v.x + v.y;
  }

  function main() {
    const v = { x: 1.0, y: 2.0 };
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub struct Vector2D {'), 'Generates Rust struct from @typedef');
  assert(rust.includes('pub x: f64,'), 'Generates struct properties');
  assert(rust.includes('Vector2D { x: 1.0, y: 2.0 }'), 'Instantiates struct from object literal');
}

// Test 8: Template Literals & Ternary Operator
{
  const js = `
  function greet(name, age) {
    const status = age >= 18 ? "adult" : "minor";
    const msg = \`Hello \${name}, you are \${status}\`;
    return msg;
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('if age >= 18 { "adult" } else { "minor" }'), 'Translates ternary operator to if-else');
  assert(rust.includes('format!("Hello {}, you are {}", name, status)'), 'Translates template literal to format!');
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
