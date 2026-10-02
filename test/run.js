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

// Test 6: Shared-State Concurrency with Arc & Mutex
{
  const js = `
  function main() {
    const counter = Arc.new(Mutex.new(0));
    let handles = [];
    for (let i = 0; i < 3; i++) {
      const c = Arc.clone(counter);
      const handle = thread.spawn(() => {
        let num = c.lock();
        num.val += 1;
      });
      handles.push(handle);
    }
    for (const h of handles) {
      h.join();
    }
    console.log("Count:", counter.lock().val);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('use std::sync::{Arc, Mutex};'), 'Imports Arc and Mutex');
  assert(rust.includes('Arc::new(Mutex::new(0));'), 'Creates Arc::new(Mutex::new(0))');
  assert(rust.includes('Arc::clone(&counter);'), 'Clones Arc with Arc::clone(&counter)');
  assert(rust.includes('c.lock().unwrap();'), 'Locks mutex with .lock().unwrap()');
  assert(rust.includes('*num += 1;'), 'Dereferences and mutates with *num += 1');
  assert(rust.includes('*counter.lock().unwrap()'), 'Dereferences locked counter');
}

// Test 7: export default
{
  const js = `
  export default function add(a, b) {
    return a + b;
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn add(a: i64, b: i64) -> i64'), 'Translates export default function to pub fn');
}

// Test 8: async / await with #[tokio::main]
{
  const js = `
  async function fetchData() {
    return 100;
  }

  async function main() {
    const data = await fetchData();
    console.log("Data:", data);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub async fn fetchData() -> i64'), 'Translates async function to pub async fn');
  assert(rust.includes('#[tokio::main]'), 'Annotates async main with #[tokio::main]');
  assert(rust.includes('async fn main()'), 'Emits async fn main()');
  assert(rust.includes('fetchData().await;'), 'Translates await fetchData() to fetchData().await');

  const files = {
    'src/main.js': js
  };
  const project = generateRustProject(files);
  assert(project['Cargo.toml'].includes('tokio = { version = "1", features = ["full"] }'), 'Includes tokio in Cargo.toml dependencies');
}

// Test 9: ES6 Class -> Rust struct + impl & new Point() -> Point::new()
{
  const js = `
  class BankAccount {
    constructor(owner, balance) {
      this.owner = owner;
      this.balance = balance;
    }

    deposit(amount) {
      this.balance += amount;
    }

    getBalance() {
      return this.balance;
    }
  }

  function main() {
    const acc = new BankAccount("Alice", 100);
    acc.deposit(50);
    console.log("Balance:", acc.getBalance());
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub struct BankAccount {'), 'Emits pub struct BankAccount');
  assert(rust.includes('pub owner: String,'), 'Infers owner: String');
  assert(rust.includes('pub balance: i64,'), 'Infers balance: i64');
  assert(rust.includes('impl BankAccount {'), 'Emits impl BankAccount');
  assert(rust.includes('pub fn new(owner: String, balance: i64) -> Self'), 'Emits pub fn new constructor');
  assert(rust.includes('pub fn deposit(&mut self, amount: i64)'), 'Infers &mut self for mutating method deposit');
  assert(rust.includes('pub fn getBalance(&self) -> i64'), 'Infers &self for read-only method getBalance');
  assert(rust.includes('let mut acc = BankAccount::new("Alice".to_string(), 100);'), 'Upgrades const acc to let mut and converts "Alice" to String');
  assert(rust.includes('acc.deposit(50);'), 'Calls acc.deposit(50)');
}

// Test 10: Unsafe block transpilation (unsafe(() => { ... }))
{
  const js = `
  function main() {
    let x = 42;
    unsafe(() => {
      console.log("Accessing unsafe block:", x);
    });
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('unsafe {'), 'Emits unsafe { ... } block');
  assert(rust.includes('println!("{:?} {:?}", "Accessing unsafe block:", x);'), 'Executes inside unsafe block');
}

// Test 11: TypeScript / Rust Enum transpilation (enum Direction)
{
  const js = `
  enum Direction {
    North,
    South,
    East,
    West
  }

  function main() {
    let dir = Direction.North;
    switch (dir) {
      case Direction.North:
        console.log("Heading North!");
        break;
      default:
        console.log("Other direction");
    }
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub enum Direction {'), 'Emits pub enum Direction');
  assert(rust.includes('North,'), 'Contains enum variant North');
  assert(rust.includes('Direction::North'), 'Translates Direction.North to Direction::North');
  assert(rust.includes('match dir {'), 'Translates switch to match');
}

// Test 12: Explicit Lifetime Annotations (@lifetime 'a)
{
  const js = `
  /**
   * @lifetime 'a
   * @param {&'a str} x
   * @param {&'a str} y
   * @returns {&'a str}
   */
  function longest(x, y) {
    if (x.length > y.length) {
      return x;
    }
    return y;
  }
  `;
  const rust = transpile(js);
  assert(rust.includes("pub fn longest<'a>(x: &'a str, y: &'a str) -> &'a str"), "Emits pub fn longest<'a> with lifetime parameter");
}

// Test 13: Traits and Interface Polymorphism (interface Summary + class implements Summary)
{
  const js = `
  interface Summary {
    summarize(): string;
  }

  class Article implements Summary {
    constructor(title, author) {
      this.title = title;
      this.author = author;
    }

    summarize() {
      return \`\${this.title} by \${this.author}\`;
    }
  }

  function main() {
    const article = new Article("Rust Guide", "Ferris");
    console.log(article.summarize());
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub trait Summary {'), 'Emits pub trait Summary');
  assert(rust.includes('fn summarize(&self) -> String;'), 'Declares fn summarize in trait');
  assert(rust.includes('impl Summary for Article {'), 'Emits impl Summary for Article');
  assert(rust.includes('fn summarize(&self) -> String {'), 'Implements fn summarize for Article');
  assert(rust.includes('article.summarize()'), 'Calls article.summarize()');
}

// Test 14: Array iterator methods (map, filter, forEach)
{
  const js = `
  function main() {
    console.log("Hello, World!");
    const a = [1, 3, 2];
    const b = a.map(x => {
      console.log(x);
    });
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('a.into_iter().map(move |x| {'), 'Translates a.map to a.into_iter().map');
  assert(rust.includes('.collect::<Vec<_>>()'), 'Collects mapped iterator to Vec');
}

// Test 15: Mutable array parameter (&mut Vec<i64>) and mutable argument passing
{
  const js = `
  function appendItem(list, item) {
    list.push(item);
  }

  function main() {
    const nums = [1, 2, 3];
    appendItem(nums, 4);

    const a = [1, 2, 3];
    a.push(4);
    const b = a.reduce((x, y) => {
      return x + y;
    }, 0);
  }
  `;
  const rust = transpile(js);
  assert(rust.includes('pub fn appendItem(list: &mut Vec<i64>, item: i64)'), 'Infers list: &mut Vec<i64> because of push');
  assert(rust.includes('let mut nums = vec![1, 2, 3];'), 'Upgrades const nums to let mut because passed as &mut');
  assert(rust.includes('appendItem(&mut nums, 4);'), 'Passes nums as &mut nums');
  assert(rust.includes('let mut a = vec![1, 2, 3];'), 'Upgrades a to let mut because of a.push(4)');
  assert(rust.includes('a.into_iter().fold(0,'), 'Translates reduce to into_iter().fold(0, ...)');
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}

