import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validateJavaScript,
  validateProject,
  transpile,
  transpileMultiModules,
  generateRustProject,
  JavaScriptValidationError,
} from '../src/index.js';
import { createPlaygroundServer } from '../playground/server.js';
import { loadTemplates } from './templates.js';

let passed = 0;
const invalidCases = [
  ['syntax', 'function main() { const x = ; }', 'JS_SYNTAX'],
  [
    'undefined read',
    'function main() { console.log(missing); }',
    'JS_UNDECLARED',
  ],
  ['undefined assignment', 'function main() { missing = 2; }', 'JS_UNDECLARED'],
  [
    'const reassignment',
    'function main() { const x = 1; x = 2; }',
    'JS_CONST_ASSIGNMENT',
  ],
  [
    'before declaration',
    'function main() { console.log(x); let x = 2; }',
    'JS_BEFORE_DECLARATION',
  ],
  [
    'self initialization',
    'function main() { const x = x; }',
    'JS_BEFORE_DECLARATION',
  ],
  [
    'missing argument',
    'function add(a,b) {return a+b;} function main(){add(1);}',
    'RUST_REQUIRED_ARGUMENTS',
  ],
  [
    'extra argument',
    'function f(a) {return a;} function main(){f(1,2);}',
    'RUST_ARGUMENT_COUNT',
  ],
  [
    'typed argument',
    'function f(x:number){return x;} function main(){f("a");}',
    'JS_ARGUMENT_TYPE',
  ],
  [
    'typed variable argument',
    'function f(x:number){return x;} function main(){const x="a";f(x);}',
    'JS_ARGUMENT_TYPE',
  ],
  ['typed return', 'function f():number {return "a";}', 'JS_RETURN_TYPE'],
  [
    'typed declaration',
    'function main(){const x:number="a";}',
    'JS_DECLARATION_TYPE',
  ],
  [
    'typed default',
    'function f(x:number="a"){return x;} function main(){f();}',
    'JS_DEFAULT_TYPE',
  ],
  [
    'variable changes type',
    'function main(){let x=1;x="a";}',
    'RUST_VARIABLE_TYPE',
  ],
  [
    'conflicting calls',
    'function f(x){return x;} function main(){f(1);f("a");}',
    'RUST_CALL_TYPE',
  ],
  [
    'method typo',
    'function main(){const a=[1,2];a.maap(x=>x);}',
    'RUST_ARRAY_METHOD',
  ],
  [
    'wrong receiver',
    'function main(){const n=2;n.split(",");}',
    'JS_METHOD_RECEIVER',
  ],
  [
    'missing callback',
    'function main(){const a=[1];a.map();}',
    'RUST_CALLBACK',
  ],
  [
    'callback array argument',
    'function main(){const a=[1];a.map((x,i,all)=>x);}',
    'RUST_CALLBACK_PARAMS',
  ],
  [
    'thisArg',
    'function main(){const a=[1];a.map(x=>x, 2);}',
    'RUST_METHOD_ARGUMENTS',
  ],
  [
    'push wrong element',
    'function main(){const a=[1];a.push("a");}',
    'RUST_ARRAY_ELEMENT',
  ],
  [
    'splice wrong index',
    'function main(){const a=[1];a.splice("0",1);}',
    'RUST_INDEX_TYPE',
  ],
  [
    'split wrong separator',
    'function main(){console.log("a".split(2));}',
    'RUST_STRING_ARGUMENT',
  ],
  [
    'regex split',
    'function main(){console.log("a".split(/a/));}',
    'RUST_SPLIT_REGEX',
  ],
  [
    'unsupported syntax',
    'function main(){try {} catch(e) {}}',
    'RUST_UNSUPPORTED_SYNTAX',
  ],
  [
    'unsupported global',
    'function main(){console.log(process.version);}',
    'RUST_UNSUPPORTED_GLOBAL',
  ],
  [
    'unsupported import',
    'import http from "node:http";',
    'RUST_EXTERNAL_MODULE',
  ],
  [
    'conditional mixed types',
    'function main(){console.log(true?1:"a");}',
    'RUST_CONDITIONAL_TYPE',
  ],
  [
    'Math ignored argument',
    'function main(){console.log(Math.max(1,2,3));}',
    'RUST_METHOD_ARGUMENTS',
  ],
];
for (const [name, source, code] of invalidCases) {
  const result = validateJavaScript(source, { filename: 'src/main.js' });
  assert.equal(result.valid, false, name);
  const item = result.diagnostics.find((d) => d.code === code);
  assert.ok(item, `${name}: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(item.filename, 'src/main.js');
  assert.ok(item.line >= 1 && item.column >= 1);
  if (['RUST_REQUIRED_ARGUMENTS', 'RUST_STRING_ARGUMENT'].includes(code))
    assert.equal(item.category, 'compatibility', name);
  assert.throws(
    () => transpile(source),
    Error,
    `${name} must not produce Rust`,
  );
  passed++;
}
for (const source of [
  'function main(){const a=[1];a.push(2);console.log(a);}',
  'function main(){let x=1;{let x="a";console.log(x);}console.log(x);}',
  'function f(x=1){return x;} function main(){console.log(f());}',
  'function f(x){return x;} function main(){f(1);f(1.5);}',
  'function f(x:number){return x;} function main(){const value=2;console.log(f(value));}',
]) {
  assert.equal(validateJavaScript(source).valid, true, source);
  passed++;
}
const multiple = validateJavaScript(
  'function main(){const x=1;x=2;console.log(missing);}',
  { filename: 'two.js' },
);
assert.equal(
  multiple.diagnostics.filter((d) => d.severity === 'error').length,
  2,
);
assert.throws(
  () => transpile('function main(){console.log(missing);}'),
  JavaScriptValidationError,
);
passed++;
const warning = validateJavaScript(
  'function main(){const a=[];console.log(a.reduce((s,x)=>s+x));}',
);
assert.equal(warning.valid, true);
assert.equal(
  warning.diagnostics.find((d) => d.code === 'JS_EMPTY_REDUCE').severity,
  'warning',
);
passed++;
// Analysis must never execute user source, including a non-terminating loop.
assert.equal(validateJavaScript('function main(){while(true){}}').valid, true);
passed++;

const project = {
  'src/main.js':
    'import {add as sum} from "./math.js"; function main(){console.log(sum(1));}',
  'src/math.js': 'export function add(a,b){return a+b;}',
};
assert.equal(validateProject(project).diagnostics[0].code, 'RUST_REQUIRED_ARGUMENTS');
assert.throws(() => transpileMultiModules(project), JavaScriptValidationError);
assert.throws(() => generateRustProject(project), JavaScriptValidationError);
passed++;
for (const [source, code] of [
  ['import {missing} from "./math.js";', 'JS_IMPORT_EXPORT'],
  ['import {add} from "./gone.js";', 'JS_IMPORT_NOT_FOUND'],
]) {
  const result = validateProject({ ...project, 'src/main.js': source });
  assert.ok(result.diagnostics.some((d) => d.code === code));
  passed++;
}
for (const [name, template] of Object.entries(loadTemplates())) {
  assert.equal(validateProject(template.files).valid, true, name);
  passed++;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'js2rust-validation-'));
try {
  const source = path.join(temp, 'invalid.js');
  const output = path.join(temp, 'output.rs');
  fs.writeFileSync(source, 'function main(){console.log(missing);}');
  fs.writeFileSync(output, 'existing output');
  const cli = spawnSync(
    process.execPath,
    ['src/cli.js', source, '-o', output],
    { encoding: 'utf8' },
  );
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /未宣告/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
  fs.writeFileSync(source, 'function main(){console.log(1);}');
  const check = spawnSync(
    process.execPath,
    ['src/cli.js', source, '--check', '-o', output],
    { encoding: 'utf8' },
  );
  assert.equal(check.status, 0, check.stderr);
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
  passed += 2;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const server = createPlaygroundServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const post = async (endpoint, body) => {
    const response = await fetch(base + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  for (const endpoint of ['/api/validate', '/api/transpile']) {
    const result = await post(endpoint, { files: project });
    assert.equal(result.status, 422);
    assert.equal(result.data.valid, false);
    assert.equal(result.data.rust, undefined);
    assert.equal(result.data.projectFiles, undefined);
    assert.equal(result.data.diagnostics[0].filename, 'src/main.js');
    passed++;
  }
  const invalid = await post('/api/transpile', {
    code: 'function main(){const a=[1];a.map(x=>{a.push(x);return x;});}',
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.diagnostics[0].filename, 'main.js');
  assert.match(invalid.data.diagnostics[0].message, /Mutating the source/);
  passed++;
  const valid = await post('/api/validate', {
    code: 'function main(){console.log(1);}',
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.rust, undefined);
  passed++;
  const asyncProject = await post('/api/transpile', {
    code: 'async function main(){console.log(1);}',
  });
  assert.equal(asyncProject.status, 200);
  assert.match(asyncProject.data.projectFiles['Cargo.toml'], /tokio/);
  passed++;
  const malformed = await fetch(base + '/api/transpile', {
    method: 'POST',
    body: '{',
  });
  assert.equal(malformed.status, 400);
  passed++;
  for (const payload of [
    { files: [] },
    { files: { 'main.js': 5 } },
    { code: 5 },
  ]) {
    assert.equal((await post('/api/transpile', payload)).status, 400);
    passed++;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log(`${passed} JavaScript validation / API / CLI checks passed.`);
