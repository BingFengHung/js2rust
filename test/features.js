import assert from 'node:assert/strict';
import { transpile, transpileWithSourceMap, transpileMultiModulesWithSourceMap, generateRustProjectWithSourceMap, originalLocation, mapRustDiagnostics, prepareComparison } from '../src/index.js';
import { executionCases } from './cases.js';
import { dataExecutionCases, dataDiagnosticCases } from './data-cases.js';
import { loadTemplates } from './templates.js';
import '../playground/history.js';
import '../playground/comparison-values.js';
import { createPlaygroundServer } from '../playground/server.js';

let passed = 0;
for (const [name, source] of [...executionCases, ...dataExecutionCases]) {
  assert.equal(transpileWithSourceMap(source).code, transpile(source), `Mapping changed generated code: ${name}`);
  passed++;
}
for (const template of Object.values(loadTemplates())) {
  const merged = transpileMultiModulesWithSourceMap(template.files);
  assert.ok(!/[\u0001\u0002]/.test(merged.code));
  const project = generateRustProjectWithSourceMap(template.files);
  assert.equal(Object.keys(project.sourceMaps).length, Object.keys(project.projectFiles).filter(f => f.endsWith('.rs')).length);
  passed++;
}
for (const [name, source, error] of dataDiagnosticCases) { assert.throws(() => transpile(source), error, name); passed++; }
const files = { 'src/main.js': 'import { twice } from "./lib.js"; function main(){ console.log(twice(2)); }', 'src/lib.js': 'export function twice(value){\n  return value * 2;\n}' };
for (const { sourceMap } of [transpileMultiModulesWithSourceMap(files), { sourceMap: generateRustProjectWithSourceMap(files).sourceMaps['src/lib/mod.rs'] }]) {
  const mapping = sourceMap.mappings.find(m => m.source.filename === 'src/lib.js' && m.source.line === 2);
  const span = { file_name: sourceMap.generatedFile, line_start: mapping.generated.line, column_start: mapping.generated.column, is_primary: true };
  assert.equal(originalLocation(sourceMap, span.line_start, span.column_start).filename, 'src/lib.js');
  const stderr = `error[E0308]: example\n  --> ${span.file_name}:${span.line_start}:${span.column_start}`;
  assert.equal(mapRustDiagnostics(stderr, sourceMap)[0].filename, 'src/lib.js');
  assert.equal(mapRustDiagnostics(JSON.stringify({ reason: 'compiler-message', message: { message: 'example', level: 'error', code: { code: 'E0308' }, spans: [span] } }), sourceMap)[0].line, 2);
  assert.equal(mapRustDiagnostics(stderr.replace(span.file_name, '/rustc/library/std.rs'), sourceMap)[0].mapped, false);
  passed += 4;
}
const { ProjectHistory } = JS2RUST_HISTORY;
const store = new Map(), storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
let clock = 10;
const history = new ProjectHistory(storage, { maxSnapshots: 3, now: () => clock++ });
const p = text => ({ files: { 'src/main.js': text }, folders: ['src'], activeFile: 'src/main.js' });
history.save(p('first')); history.save(p('second'));
assert.equal(history.load().project.files['src/main.js'], 'second');
store.set('js2rust_saved_project', 'broken');
assert.equal(history.load().recovered, true); assert.equal(history.load().project.files['src/main.js'], 'first');
const first = history.snapshot(p('first'), '<script>name</script>');
assert.equal(history.snapshot(p('first')), first); assert.equal(history.list().length, 1);
history.snapshot(p('second')); history.snapshot(p('third'));
assert.deepEqual(history.diff(first, p('second')), [{ filename: 'src/main.js', before: 'first', after: 'second', status: '修改' }]);
assert.equal(history.restore(first, p('third')).files['src/main.js'], 'first');
history.snapshot(p('fourth')); assert.equal(history.list().length, 3);
assert.throws(() => history.save({ files: { '../outside.js': 'bad' } }), /格式不符/);
const quota = new ProjectHistory({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
assert.throws(() => quota.save(p('x')), /quota/); assert.throws(() => quota.snapshot(p('x')), /quota/);
passed += 10;
const prepared = prepareComparison(files, { entry: 'main' });
const logs = [];
const result = new Function('args', 'console', prepared.javascript)([], { log: (...values) => logs.push(values) });
assert.equal(result, undefined); assert.deepEqual(logs, [[4]]);
assert.throws(() => prepareComparison(files, { entry: 'missing' }), /找不到函式/);
assert.throws(() => prepareComparison(files, { cases: [] }), /1–20/);
assert.throws(() => prepareComparison({ 'main.js': 'async function main(){}' }), /RUST_COMPARISON_SUBSET/);
assert.throws(() => prepareComparison(files, { cases: [[NaN]] }), /JSON/);
assert.throws(() => prepareComparison(files, { cases: [[-0]] }), /負零/);
assert.notDeepEqual(JS2RUST_COMPARISON.encodeValue(-0), JS2RUST_COMPARISON.encodeValue(0));
passed += 7;
const server = createPlaygroundServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, payload) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let response = await request('/api/transpile', { files });
  const output = await response.json(); assert.equal(response.status, 200); assert.ok(output.sourceMap.mappings.length); assert.ok(output.sourceMaps['src/lib/mod.rs']);
  response = await request('/api/prepare-comparison', { files }); assert.equal(response.status, 200); assert.ok((await response.json()).javascript);
  response = await request('/api/prepare-comparison', { files, cases: [1] }); assert.equal(response.status, 400);
  response = await request('/api/map-diagnostics', { stderr: 'error: example\n --> src/main.rs:1:1', sourceMaps: output.sourceMap }); assert.equal(response.status, 200); assert.equal((await response.json()).diagnostics[0].mapped, false);
  for (const filename of ['history.js', 'comparison-values.js', 'compare-worker.js']) { response = await fetch(url + '/' + filename); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/); }
  passed += 7;
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
console.log(`${passed} source mapping / data / comparison / history checks passed.`);
