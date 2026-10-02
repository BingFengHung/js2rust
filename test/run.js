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

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
