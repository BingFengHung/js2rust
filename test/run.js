/**
 * Automated Test Runner for js-to-rust
 */

import { transpile, transpileMultiModules, generateRustProject } from '../src/index.js';

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

// Test 3: Multi-Module & Nested Folders (e.g. src/utils/math.js)
{
  const files = {
    'src/main.js': `
    import { add } from './utils/math.js';
    function main() {
      console.log(add(10, 20));
    }
    `,
    'src/utils/math.js': `
    export function add(a, b) {
      return a + b;
    }
    `
  };
  const rust = transpileMultiModules(files);
  assert(rust.includes('pub mod utils {'), 'Creates parent module pub mod utils');
  assert(rust.includes('pub mod math {'), 'Creates nested module pub mod math');
  assert(rust.includes('use utils::math::add;'), 'Translates nested import to use utils::math::add;');
  assert(rust.includes('fn main()'), 'Includes main function');

  // Test 4: generateRustProject generates multi-file Cargo project structure
  const project = generateRustProject(files);
  assert(Boolean(project['Cargo.toml']), 'Generates Cargo.toml');
  assert(Boolean(project['src/main.rs']), 'Generates src/main.rs');
  assert(Boolean(project['src/utils/mod.rs']), 'Generates src/utils/mod.rs');
  assert(Boolean(project['src/utils/math.rs']), 'Generates src/utils/math.rs');
  assert(project['src/main.rs'].includes('mod utils;'), 'src/main.rs declares mod utils;');
  assert(project['src/utils/mod.rs'].includes('pub mod math;'), 'src/utils/mod.rs declares pub mod math;');
  assert(project['src/utils/math.rs'].includes('pub fn add'), 'src/utils/math.rs contains compiled add function');
}

// Test 5: Fearless Concurrency (thread.spawn, mpsc channel, closure, join)
{
  const js = `
  function main() {
    const [tx, rx] = mpsc.channel();
    const handle = thread.spawn(() => {
      tx.send(42);
    });
    const result = rx.recv();
    handle.join();
    console.log("Result:", result);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('use std::thread;'), 'Imports std::thread');
  assert(rust.includes('use std::sync::mpsc;'), 'Imports std::sync::mpsc');
  assert(rust.includes('let (tx, rx) = mpsc::channel();'), 'Destructures channel tuple let (tx, rx)');
  assert(rust.includes('thread::spawn(move ||'), 'Spawns thread with move closure');
  assert(rust.includes('tx.send(42).unwrap();'), 'Sends message on channel with unwrap');
  assert(rust.includes('rx.recv().unwrap();'), 'Receives message with unwrap');
  assert(rust.includes('handle.join().unwrap();'), 'Joins thread handle with unwrap');
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
