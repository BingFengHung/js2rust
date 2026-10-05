import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareComparison, parseComparisonOutput, transpileWithSourceMap, mapRustDiagnostics, transpileMultiModulesWithSourceMap, generateRustProjectWithSourceMap } from '../src/index.js';
import { dataExecutionCases } from './data-cases.js';
import '../playground/comparison-values.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'js2rust-compare-'));
let passed = 0;
function compile(code) {
  const filename = path.join(temp, 'main.rs'), bin = path.join(temp, 'main'); fs.writeFileSync(filename, code);
  const compilation = spawnSync('rustc', ['--edition=2021', '-A', 'warnings', filename, '-o', bin], { encoding: 'utf8', timeout: 30000 });
  assert.equal(compilation.status, 0, compilation.stderr + '\n' + code);
  const run = spawnSync(bin, [], { encoding: 'utf8', timeout: 5000 }); assert.equal(run.status, 0, run.stderr); return run.stdout;
}
function compare(files, options) {
  const prepared = prepareComparison(files, options);
  const expected = prepared.cases.map(args => {
    const logs = [];
    const result = new Function('args', 'console', prepared.javascript)(args, { log: (...values) => logs.push(values.map(v => JS2RUST_COMPARISON.encodeValue(v))) });
    return { value: JS2RUST_COMPARISON.encodeValue(result), logs };
  });
  const stdout = compile(prepared.rust);
  assert.deepEqual(parseComparisonOutput(stdout), expected);
  // The browser parses the same protocol as the library API.
  assert.deepEqual(JS2RUST_COMPARISON.parseRustResults(stdout), expected);
  passed++;
}
try {
  for (const [name, source] of dataExecutionCases) { compare({ 'src/main.ts': source }); console.log(`  ✓ comparison ${name}`); }
  compare({ 'src/main.ts': 'function total(values:number[]):number{const doubled=values.map(v=>v*2);console.log(doubled);return doubled.reduce((s,v)=>s+v,0);}function main(){total([1,2]);}' }, { entry: 'total', cases: [[[1,2]], [[0]], [[]], [[1.5]]] });
  compare({ 'src/main.ts': 'import calc from "./calc.ts";function total(v:number):number{console.log(calc(v));return calc(v);}function main(){total(1);}', 'src/calc.ts': 'export default function calculate(value:number):number{return value/2;}' }, { entry: 'total', cases: [[1], [5]] });
  compare({ 'src/main.js': 'import {twice} from "./lib.js";function main(){twice(1);}', 'src/lib.js': 'export function twice(value){return value*2;}' }, { entryFile: 'src/lib.js', entry: 'twice', cases: [[1], [2.5]] });
  const modules = { 'src/main.js': 'import { findValue } from "./lib.js";function main(){console.log(findValue()??5);}', 'src/lib.js': 'export function findValue(){return [1].find(x=>x>2);}' };
  compare({ 'src/main.js': 'function main(){const s=new Set([NaN,0/-1]);console.log(Array.from(s));const m=new Map([[0/-1,3],[NaN,4]]);console.log(Array.from(m.keys()));}' });
  const negative = prepareComparison({ 'src/main.js': 'function main(){}function value(){return -0;}' }, { entry: 'value' });
  const negativeResult = parseComparisonOutput(compile(negative.rust));
  assert.notDeepEqual(negativeResult[0].value, JS2RUST_COMPARISON.encodeValue(new Function('args','console',negative.javascript)([],console))); passed++;
  assert.equal(compile(transpileMultiModulesWithSourceMap(modules).code), '5\n');
  const project = generateRustProjectWithSourceMap(modules);
  for (const [filename, content] of Object.entries(project.projectFiles)) { const target = path.join(temp, filename); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  const cargo = spawnSync('cargo', ['run', '--quiet', '--manifest-path', path.join(temp, 'Cargo.toml')], { encoding: 'utf8', timeout: 30000 }); assert.equal(cargo.status, 0, cargo.stderr); assert.equal(cargo.stdout, '5\n'); passed += 2;
  const broken = 'class C{constructor(){this.n=1;}}\nfunction main(){const c=new C();console.log(c.missing());}';
  const filename = path.join(temp, 'main.rs'), mapped = transpileWithSourceMap(broken, { filename: 'src/main.js', generatedFile: filename }); fs.writeFileSync(filename, mapped.code);
  const failure = spawnSync('rustc', ['--edition=2021', '--error-format=json', filename], { encoding: 'utf8', timeout: 30000 }); assert.notEqual(failure.status, 0);
  const diagnostics = mapRustDiagnostics(failure.stderr, mapped.sourceMap); assert.ok(diagnostics.some(d => d.mapped && d.filename === 'src/main.js' && d.line === 2)); passed++;
  console.log(`${passed} compiled comparison / source mapping checks passed.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
