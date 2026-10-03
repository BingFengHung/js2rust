import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { transpile, transpileMultiModules, generateRustProject } from '../src/index.js';
import { executionCases, diagnosticCases } from './cases.js';
import { loadTemplates } from './templates.js';

for (const tool of ['rustc', 'cargo']) {
  const result = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${tool} is required for test:rust. Install the Rust toolchain and retry.`);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'js2rust-tests-'));
const executable = path.join(temp, process.platform === 'win32' ? 'case.exe' : 'case');
let passed = 0;
const canonical = line => {
  if (line.startsWith('[')) { try { return JSON.stringify(JSON.parse(line)); } catch {} }
  return line;
};
function javascriptOutput(source) {
  const lines = [];
  vm.runInNewContext(`${source}\nmain();`, { console: { log: (...args) => lines.push(args.map(v => Array.isArray(v) ? JSON.stringify(v) : String(v)).join(' ')) } }, { timeout: 2000 });
  return lines.map(canonical).join('\n') + '\n';
}
function executeRust(source, allowFailure = false) {
  const filename = path.join(temp, 'case.rs');
  fs.writeFileSync(filename, source);
  const compile = spawnSync('rustc', ['--edition=2021', '-A', 'warnings', filename, '-o', executable], { encoding: 'utf8', timeout: 30000 });
  assert.equal(compile.status, 0, `Rust compilation failed:\n${compile.stderr}\n${source}`);
  const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 5000 });
  if (!allowFailure) assert.equal(run.status, 0, `Rust execution failed: ${run.error || run.stderr}`);
  return run;
}
try {
  for (const [name, source] of executionCases) {
    const expected = javascriptOutput(source);
    const run = executeRust(transpile(source));
    const actual = run.stdout.replaceAll('\r\n', '\n').split('\n').map(canonical).join('\n');
    assert.equal(actual, expected, `${name}: JavaScript and Rust outputs differ`);
    console.log(`  ✓ ${name} — compiled, executed, matched Node.js`);
    passed++;
  }
  for (const [name, source, error] of diagnosticCases) {
    assert.throws(() => transpile(source), error);
    console.log(`  ✓ ${name} — explicit diagnostic`);
    passed++;
  }
  const emptyReduce = 'function main() { const a = []; console.log(a.reduce((s, x) => s + x)); }';
  assert.throws(() => javascriptOutput(emptyReduce), /Reduce of empty array/);
  const emptyRun = executeRust(transpile(emptyReduce), true);
  assert.notEqual(emptyRun.status, 0);
  assert.match(emptyRun.stderr, /reduce of empty array/);
  passed++;

  const unicodeRun = executeRust(transpile('function main() { console.log("😀".split("")); }'), true);
  assert.notEqual(unicodeRun.status, 0);
  assert.match(unicodeRun.stderr, /non-BMP text is unsupported/);
  passed++;

  const typed = 'function twice(x: number): number { return x * 2; } function main() { console.log(twice(1.5)); }';
  assert.equal(executeRust(transpile(typed)).stdout.trim(), '3');
  passed++;

  const files = {
    'src/main.js': 'import { add as sum } from "./utils/math.js"; import calc from "./default.js"; import { added } from "./utils/ops.js"; function main() { console.log(sum(1, 2)); console.log(calc(3, 4)); console.log(added(5, 6)); }',
    'src/utils/math.js': 'export function add(a, b) { return a + b; }',
    'src/utils/ops.js': 'import { add } from "./math.js"; export function added(a, b) { return add(a, b); }',
    'src/default.js': 'export default function calculate(a, b) { return a * b; }',
  };
  assert.equal(executeRust(transpileMultiModules(files)).stdout, '3\n12\n11\n');
  const project = generateRustProject(files);
  for (const [relative, content] of Object.entries(project)) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const cargo = spawnSync('cargo', ['run', '--quiet', '--manifest-path', path.join(temp, 'Cargo.toml')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(cargo.status, 0, cargo.stderr);
  assert.equal(cargo.stdout, '3\n12\n11\n');
  passed += 2;
  for (const [name, template] of Object.entries(loadTemplates())) {
    const generated = generateRustProject(template.files);
    const projectDir = path.join(temp, name);
    for (const [relative, content] of Object.entries(generated)) {
      const target = path.join(projectDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const run = spawnSync('cargo', ['run', '--quiet', '--manifest-path', path.join(projectDir, 'Cargo.toml')], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CARGO_TARGET_DIR: path.join(temp, 'target'), RUSTFLAGS: '-A warnings' },
    });
    assert.equal(run.status, 0, `Template ${name} failed: ${run.error || run.stderr}`);
    console.log(`  ✓ Playground ${name} — Cargo compiled and executed`);
    // Standard-library templates must also work as the merged single-file output.
    if (!generated['Cargo.toml'].includes('tokio =')) executeRust(transpileMultiModules(template.files));
    passed++;
  }
  console.log(`\n${passed} Rust execution / diagnostic checks passed.\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
