/**
 * Module System Transpiler for js-to-rust
 * Handles ES Modules (import / export) and bundles multi-file & nested folders into Rust's module hierarchy.
 */

import { parse } from '@babel/parser';
import path from 'node:path';
import { transpile } from './index.js';
import { RustEmitter } from './codegen.js';
import { assertValid, validateProject } from './validation.js';
import { RUST_RUNTIME } from './runtime.js';

/**
 * Normalizes a file path by removing leading './' or 'src/'
 */
function normalizePath(p) {
  return p.replace(/^\.\//, '').replace(/^src\//, '').replace(/^\//, '');
}

/**
 * Automatically finds the main entry point file from a set of files
 */
function findMainFilename(files) {
  const keys = Object.keys(files);
  // 1. Look for main.js or src/main.js
  const main = keys.find((k) => /(^|\/)main\.(js|ts|mjs)$/i.test(k));
  if (main) return main;

  // 2. Look for index.js or src/index.js
  const index = keys.find((k) => /(^|\/)index\.(js|ts|mjs)$/i.test(k));
  if (index) return index;

  // 3. Look for file containing `function main(`
  const withMainFn = keys.find((k) => /function\s+main\s*\(/.test(files[k]));
  if (withMainFn) return withMainFn;

  // 4. Default to first key
  return keys[0];
}

/**
 * Scans all module files to collect shared enums, classes, signatures, and mutating methods
 */
function collectCrossModuleMetadata(files, options) {
  const sharedEnums = new Set(options.sharedEnums || []);
  const sharedMutatingMethods = new Set(options.sharedMutatingMethods || []);
  const sharedClasses = new Set(options.sharedClasses || []);
  const sharedSignatures = new Map(options.sharedSignatures || []);

  const metadata = new Map();
  const moduleExports = new Map();
  for (const [rawPath, source] of Object.entries(files)) {
    const ast = parse(source, {
      sourceType: 'module', allowReturnOutsideFunction: true,
      plugins: ['classProperties', 'numericSeparator', 'typescript'],
    });
    const emitter = new RustEmitter(options);
    emitter.rootAst = ast;
    emitter.collectTypeDefs(ast.comments);
    emitter.collectClasses(ast.program);
    emitter.collectSignatures(ast.program, ast);
    const exports = new Map();
    for (const stmt of ast.program.body) {
      if (stmt.type === 'ExportDefaultDeclaration') exports.set('default', stmt.declaration.id?.name || 'default_export');
      if (stmt.type === 'ExportNamedDeclaration') {
        if (stmt.declaration?.id) exports.set(stmt.declaration.id.name, stmt.declaration.id.name);
        for (const spec of stmt.specifiers) exports.set(spec.exported.name, spec.local.name);
      }
    }
    moduleExports.set(path.posix.normalize(rawPath), exports);
    metadata.set(path.posix.normalize(rawPath), { ast, emitter });
    emitter.enums.forEach(v => sharedEnums.add(v));
    emitter.classes.forEach(v => sharedClasses.add(v));
    emitter.classMutatingMethods.forEach(v => sharedMutatingMethods.add(v));
  }

  return {
    ...options,
    sharedEnums,
    sharedMutatingMethods,
    sharedClasses,
    sharedSignatures,
    metadata,
    moduleExports,
  };
}


function optionsForFile(rawPath, options) {
  const filename = path.posix.normalize(rawPath);
  const own = options.metadata.get(filename);
  const signatures = new Map(own.emitter.signatures);
  const returns = new Map(own.emitter.returnTypes);
  for (const stmt of own.ast.program.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), stmt.source.value));
    const target = options.metadata.get(resolved);
    if (!target) throw new Error(`Cannot resolve ${stmt.source.value} imported by ${rawPath}`);
    for (const spec of stmt.specifiers) {
      const exported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name;
      const original = options.moduleExports.get(resolved)?.get(exported);
      if (spec.type !== 'ImportNamespaceSpecifier' && !original) throw new Error(`Unknown export ${exported} in ${resolved}`);
      if (target.emitter.signatures.has(original)) signatures.set(spec.local.name, target.emitter.signatures.get(original));
      if (target.emitter.returnTypes.has(original)) returns.set(spec.local.name, target.emitter.returnTypes.get(original));
    }
  }
  return { ...options, filename, sharedSignatures: signatures, sharedReturnTypes: returns };
}

/**
 * Transpiles multiple JavaScript files (including folders) into a single cohesive Rust program.
 * @param {Record<string, string>} files - Map of filename/path to JS source code.
 * @param {object} [options] - Compiler options.
 * @returns {string} - The combined Rust source code.
 */
export function transpileMultiModules(files, options = {}) {
  const filenames = Object.keys(files);

  if (filenames.length === 0) {
    return '';
  }
  assertValid(validateProject(files, options));

  const moduleOptions = collectCrossModuleMetadata(files, options);

  // Find main entry point (main.js, index.js, or file with function main())
  const mainFilename = findMainFilename(files);

  let mainRust = '';
  let needsRuntime = false;
  const sharedRuntime = (code, main = false) => {
    if (!code.includes(RUST_RUNTIME.trim())) return code;
    needsRuntime = true;
    return `${main ? '' : 'use crate::__js2rust;\n'}${code.replace(RUST_RUNTIME.trim(), '')}`;
  };

  // Build hierarchical module tree
  const rootModule = { children: {} };

  for (const rawPath of filenames) {
    const norm = normalizePath(rawPath);
    const code = files[rawPath];

    if (rawPath === mainFilename) {
      // Transpile main file (this will automatically convert `import` to `use path::item;`)
      mainRust = sharedRuntime(transpile(code, optionsForFile(rawPath, moduleOptions)), true);
    } else {
      // It's a module file (may be inside nested folders like utils/math.js)
      const parts = norm
        .replace(/\.(js|ts|mjs)$/, '')
        .split('/')
        .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));

      const compiledCode = sharedRuntime(transpile(code, optionsForFile(rawPath, moduleOptions)));

      // Insert into module tree
      let curr = rootModule;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!curr.children[part]) {
          curr.children[part] = { children: {}, code: null };
        }
        if (i === parts.length - 1) {
          curr.children[part].code = compiledCode;
        }
        curr = curr.children[part];
      }
    }
  }

  // Render module tree into Rust nested `pub mod ...`
  function renderTree(node, indent = 0) {
    const sp = ' '.repeat(indent);
    let out = '';

    for (const [modName, child] of Object.entries(node.children)) {
      out += `${sp}pub mod ${modName} {\n`;
      if (child.code) {
        const indentedCode = child.code
          .split('\n')
          .map((line) => (line.trim() ? `${sp}    ${line}` : ''))
          .join('\n');
        out += `${indentedCode}\n`;
      }
      out += renderTree(child, indent + 4);
      out += `${sp}}\n\n`;
    }

    return out;
  }

  const modulesRust = renderTree(rootModule);

  let finalOutput = '#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n';
  if (needsRuntime) finalOutput += RUST_RUNTIME + '\n';
  if (modulesRust.trim()) {
    finalOutput += `// === Modules & Nested Folders ===\n${modulesRust}`;
  }
  finalOutput += `// === Main Application ===\n${mainRust}`;

  return finalOutput.trim() + '\n';
}

/**
 * Generates a full multi-file Rust Cargo project structure.
 * Returns a dictionary mapping relative file paths to their Rust source content:
 * e.g. {
 *   "Cargo.toml": "...",
 *   "src/main.rs": "...",
 *   "src/utils/mod.rs": "...",
 *   "src/utils/math.rs": "..."
 * }
 * @param {Record<string, string>} files - Map of filename/path to JS source code.
 * @param {object} [options] - Compiler options.
 * @returns {Record<string, string>} - Map of file paths to generated file contents.
 */
export function generateRustProject(files, options = {}) {
  const filenames = Object.keys(files);
  if (filenames.length === 0) {
    return {};
  }
  assertValid(validateProject(files, options));

  const moduleOptions = collectCrossModuleMetadata(files, options);

  const project = {};

  // 1. Cargo.toml (Include tokio if async/await or Promise is detected)
  const hasAsync = Object.values(files).some((code) => /\basync\s+function\b|\bawait\b|\bPromise\b/.test(code));
  let dependencies = '';
  if (hasAsync) {
    dependencies = 'tokio = { version = "1", features = ["full"] }\n';
  }

  project['Cargo.toml'] = `[package]
name = "js2rust_app"
version = "0.1.0"
edition = "2021"

[dependencies]
${dependencies}`;

  const mainFilename = findMainFilename(files);

  // Collect top-level modules and nested folder module structure
  // folderDeclarations: Map<folderPath, Set<childModName>>
  const folderDeclarations = new Map();
  const topLevelMods = new Set();
  let needsRuntime = false;

  for (const rawPath of filenames) {
    if (rawPath === mainFilename) continue;

    const norm = normalizePath(rawPath);
    const parts = norm
      .replace(/\.(js|ts|mjs)$/, '')
      .split('/')
      .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));

    const code = files[rawPath];
    let compiledCode = transpile(code, optionsForFile(rawPath, moduleOptions));
    if (compiledCode.includes(RUST_RUNTIME.trim())) { needsRuntime = true; compiledCode = 'use crate::__js2rust;\n' + compiledCode.replace(RUST_RUNTIME.trim(), ''); }

    // rustFilePath: e.g. 'src/utils/math.rs'
    // A top-level lib.rs is auto-built by Cargo as a separate crate. Use a module
    // directory instead, and also co-locate files that have child modules.
    const stem = parts.join('/');
    const hasChildren = filenames.some(f => normalizePath(f).replace(/\.(js|ts|mjs)$/, '').startsWith(norm.replace(/\.(js|ts|mjs)$/, '') + '/'));
    const rustFilePath = stem === 'lib' || hasChildren ? `src/${stem}/mod.rs` : `src/${stem}.rs`;
    project[rustFilePath] = compiledCode;

    // Track top-level module
    topLevelMods.add(parts[0]);

    // Track parent folder mod.rs declarations
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = `src/${parts.slice(0, i + 1).join('/')}`;
      const childMod = parts[i + 1];
      if (!folderDeclarations.has(folderPath)) {
        folderDeclarations.set(folderPath, new Set());
      }
      folderDeclarations.get(folderPath).add(childMod);
    }
  }

  // 2. Generate mod.rs for each folder that contains submodules
  for (const [folderPath, submodules] of folderDeclarations.entries()) {
    const modRsPath = `${folderPath}/mod.rs`;
    const sortedMods = Array.from(submodules).sort();
    const modContent = sortedMods.map((m) => `pub mod ${m};`).join('\n') + '\n';
    project[modRsPath] = modContent + (project[modRsPath] || '');
  }

  // 3. Generate src/main.rs
  const mainJsCode = files[mainFilename] || '';
  let mainCompiled = transpile(mainJsCode, optionsForFile(mainFilename, moduleOptions));
  if (mainCompiled.includes(RUST_RUNTIME.trim())) { needsRuntime = true; mainCompiled = mainCompiled.replace(RUST_RUNTIME.trim(), ''); }

  let mainRsHeader = '#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n';
  if (needsRuntime) mainRsHeader += RUST_RUNTIME + '\n';
  if (topLevelMods.size > 0) {
    const sortedTopMods = Array.from(topLevelMods).sort();
    mainRsHeader += sortedTopMods.map((m) => `mod ${m};`).join('\n') + '\n\n';
  }

  project['src/main.rs'] = `${mainRsHeader}${mainCompiled}`.trim() + '\n';

  return project;
}
