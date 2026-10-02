/**
 * Automated Test Runner for js-to-rust
 */

import { transpile, transpileMultiModules } from '../src/index.js';

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

// Test 2: Smart Type Inference from call sites (No JSDoc required!)
{
  const js = `
  function ask(greet) {
    console.log(greet);
  }
  function main() {
    ask("12");
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn ask(greet: &str)'), 'Auto-infers greet: &str from ask("12") call site');
}

// Test 3: JSDoc type mapping
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

// Test 4: For loop range mapping
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

// Test 7: Multi-Module ES import/export to Rust mod/use
{
  const files = {
    'main.js': `
    import { add } from './math.js';
    function main() {
      console.log(add(10, 20));
    }
    `,
    'math.js': `
    export function add(a, b) {
      return a + b;
    }
    `
  };
  const rust = transpileMultiModules(files);
  assert(rust.includes('pub mod math {'), 'Bundles math.js into pub mod math');
  assert(rust.includes('use math::add;'), 'Translates ES import to Rust use statement');
  assert(rust.includes('fn main()'), 'Includes main application code');
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
