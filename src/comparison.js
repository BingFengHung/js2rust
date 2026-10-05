import path from 'node:path';
import generateModule from '@babel/generator';
import traverseModule from '@babel/traverse';
import { parseJavaScript, validateProject, assertValid, diagnostic, JavaScriptValidationError } from './validation.js';
import { transpileMultiModulesWithSourceMap } from './index.js';

const generate = generateModule.default || generateModule;
const traverse = traverseModule.default || traverseModule;
export const LOG_MARKER = '__JS2RUST_LOG__';
export const RESULT_MARKER = '__JS2RUST_RESULT__';

/** Prepare code only. Neither the server nor this API executes user code. */
export function prepareComparison(files, { entry = 'main', cases = [[]], entryFile } = {}) {
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.keys(files).length || Object.values(files).some(v => typeof v !== 'string')) throw new TypeError('files 必須包含程式碼字串。');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(entry) || entry.startsWith('__js2rust')) throw new TypeError('請提供一般函式名稱作為測試入口。');
  if (!Array.isArray(cases) || !cases.length || cases.length > 20 || cases.some(c => !Array.isArray(c)) || JSON.stringify(cases).length > 100000) throw new TypeError('測試案例需要 1–20 組 JSON 參數陣列。');
  // Ensure API callers follow the same JSON-only contract as the UI.
  const jsonCases = JSON.parse(JSON.stringify(cases));
  if (JSON.stringify(cases, (_key, value) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('測試輸入僅接受有限數值與 JSON 值。');
    if (Object.is(value, -0)) throw new TypeError('JSON 參數目前不支援負零 -0；請在函式內建立負零來比較結果。');
    return value;
  }) !== JSON.stringify(jsonCases)) throw new TypeError('測試輸入需要 JSON 值。');
  assertValid(validateProject(files));
  const filenames = Object.keys(files);
  const mainFile = filenames.find(f => /(?:^|\/)main\.(?:js|ts|mjs)$/.test(f)) || filenames.find(f => /(?:^|\/)index\.(?:js|ts|mjs)$/.test(f)) || filenames.find(f => /function\s+main\s*\(/.test(files[f])) || filenames[0];
  entryFile ||= mainFile;
  if (!(entryFile in files)) throw new TypeError('找不到入口檔案。');
  const parsed = new Map(Object.entries(files).map(([name, source]) => [name, parseJavaScript(source, name).ast]));
  const entryAst = parsed.get(entryFile);
  const entryNode = entryAst.program.body.map(n => n.declaration || n).find(n => n.type === 'FunctionDeclaration' && n.id?.name === entry);
  if (!entryNode) throw new TypeError(`入口檔案 ${entryFile} 找不到函式 ${entry}。`);
  const bad = [];
  for (const [name, ast] of parsed) traverse(ast, { enter(p) {
    if (p.node.async || ['TSEnumDeclaration', 'TSInterfaceDeclaration', 'ClassDeclaration', 'ObjectExpression'].includes(p.node.type) || p.isCallExpression() && ['thread', 'Thread', 'mpsc', 'Arc', 'Mutex'].includes(p.node.callee.object?.name)) bad.push(diagnostic(p.node, 'RUST_COMPARISON_SUBSET', '執行對照目前支援同步函式及基本資料型別；此語法需要獨立執行環境。', name, 'error', 'compatibility'));
    if (p.isVariableDeclaration() && p.parentPath.isProgram()) bad.push(diagnostic(p.node, 'RUST_COMPARISON_GLOBAL', '執行對照請將可變資料放在函式內。', name, 'error', 'compatibility'));
  } });
  if (bad.length) throw new JavaScriptValidationError(bad);
  if (jsonCases.some(args => args.length > entryNode.params.length || args.length < entryNode.params.filter(p => p.type !== 'AssignmentPattern').length)) throw new TypeError('測試案例的參數數量與入口函式不符。');

  const normalized = new Map(Object.keys(files).map(f => [path.posix.normalize(f), f]));
  function resolve(from, spec) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    const found = [base, `${base}.js`, `${base}.ts`, `${base}.mjs`].map(f => normalized.get(f)).find(Boolean);
    if (!found) throw new TypeError(`找不到模組 ${spec}。`);
    return found;
  }
  const bundled = [], done = new Map(), visiting = new Set();
  function bundle(name) {
    if (done.has(name)) return done.get(name);
    if (visiting.has(name)) throw new TypeError('執行對照目前不支援循環匯入。');
    visiting.add(name);
    const ast = parsed.get(name), imports = [], exports = [];
    const body = [];
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration') {
        const id = bundle(resolve(name, node.source.value));
        for (const spec of node.specifiers) imports.push(`const ${spec.local.name} = ${id}[${JSON.stringify(spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported.name || spec.imported.value)}];`);
      } else if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          body.push(node.declaration);
          if (node.declaration.id) exports.push([node.declaration.id.name, node.declaration.id.name]);
          for (const d of node.declaration.declarations || []) exports.push([d.id.name, d.id.name]);
        }
        for (const spec of node.specifiers) exports.push([spec.exported.name, spec.local.name]);
      } else if (node.type === 'ExportDefaultDeclaration') {
        const declaration = node.declaration;
        if (declaration.type === 'FunctionDeclaration') {
          declaration.id ||= { type: 'Identifier', name: '__js2rust_default' };
          body.push(declaration); exports.push(['default', declaration.id.name]);
        } else { body.push({ type: 'VariableDeclaration', kind: 'const', declarations: [{ type: 'VariableDeclarator', id: { type: 'Identifier', name: '__js2rust_default' }, init: declaration }] }); exports.push(['default', '__js2rust_default']); }
      } else body.push(node);
    }
    ast.program.body = body;
    traverse(ast, {
      TSTypeAnnotation(p) { p.remove(); },
      TSTypeParameterInstantiation(p) { p.remove(); },
      TSTypeAliasDeclaration(p) { p.remove(); },
      TSAsExpression(p) { p.replaceWith(p.node.expression); },
      ClassProperty(p) { p.node.accessibility = null; p.node.readonly = false; p.node.declare = false; p.node.optional = false; },
      ClassMethod(p) { p.node.accessibility = null; p.node.optional = false; },
    });
    if (name === entryFile) exports.push(['__entry', entry]);
    const id = `__module_${done.size}`;
    done.set(name, id); visiting.delete(name);
    bundled.push(`const ${id} = (() => { ${imports.join('\n')}\n${generate(ast).code}\nreturn {${exports.map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(',')}}; })();`);
    return id;
  }
  const module = bundle(entryFile);
  const javascript = `"use strict";\n${bundled.join('\n')}\nreturn ${module}.__entry(...args);`;

  const seeded = { ...files };
  seeded[entryFile] += '\n' + jsonCases.map((args, i) => `function js2rustCase${i}(){ return ${entry}(${args.map(a => JSON.stringify(a)).join(',')}); }`).join('\n');
  const rust = transpileMultiModulesWithSourceMap(seeded, { comparison: true });
  // Seed calls drive type inference; their generated locations have no original JS source.
  const originalLines = files[entryFile].split('\n').length;
  rust.sourceMap.mappings = rust.sourceMap.mappings.filter(m => m.source.filename !== entryFile || m.source.line <= originalLines);
  const prefix = entryFile === mainFile ? '' : 'crate::' + entryFile.replace(/^\.\//, '').replace(/^src\//, '').replace(/\.(js|ts|mjs)$/, '').split('/').map(s => s.replace(/[^a-zA-Z0-9_]/g, '_')).join('::') + '::';
  rust.code += `\nfn main() {\n${jsonCases.map((_, i) => `    let result = ${prefix}js2rustCase${i}();\n    println!("${RESULT_MARKER}{}", __js2rust::json(&result));`).join('\n')}\n}\n`;
  return { javascript, rust: rust.code, sourceMap: rust.sourceMap, cases: jsonCases, entry, entryFile };
}

export function parseComparisonOutput(stdout) {
  const results = [], logs = [];
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith(LOG_MARKER)) logs.push(JSON.parse(line.slice(LOG_MARKER.length)));
    if (line.startsWith(RESULT_MARKER)) { results.push({ value: JSON.parse(line.slice(RESULT_MARKER.length)), logs: logs.splice(0) }); }
  }
  return results;
}
