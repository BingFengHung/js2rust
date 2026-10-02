/**
 * Module System Transpiler for js-to-rust
 * Handles ES Modules (import / export) and bundles multi-file & nested folders into Rust's module hierarchy.
 */

import { parse } from '@babel/parser';
import { transpile } from './index.js';
import { doesMethodMutateThis } from './codegen.js';

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
 * Scans all module files to collect shared enums, classes, and mutating methods
 */
function collectCrossModuleMetadata(files, options) {
  const sharedEnums = new Set(options.sharedEnums || []);
  const sharedMutatingMethods = new Set(options.sharedMutatingMethods || []);
  const sharedClasses = new Set(options.sharedClasses || []);

  for (const rawPath of Object.keys(files)) {
    try {
      const ast = parse(files[rawPath], {
        sourceType: 'module',
        allowReturnOutsideFunction: true,
        plugins: ['classProperties', 'numericSeparator', 'typescript'],
      });
      for (let stmt of ast.program.body) {
        if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration) {
          stmt = stmt.declaration;
        }
        if (stmt.type === 'TSEnumDeclaration') {
          sharedEnums.add(stmt.id.name);
        } else if (stmt.type === 'ClassDeclaration') {
          const className = stmt.id ? stmt.id.name : 'Anonymous';
          sharedClasses.add(className);
          const methods = stmt.body.body.filter((m) => m.type === 'ClassMethod' && m.kind === 'method');
          for (const m of methods) {
            if (doesMethodMutateThis(m.body)) {
              sharedMutatingMethods.add(m.key.name);
            }
          }
        }
      }
    } catch (e) {
      // ignore parse errors in pre-pass
    }
  }

  return {
    ...options,
    sharedEnums,
    sharedMutatingMethods,
    sharedClasses,
  };
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

  const moduleOptions = collectCrossModuleMetadata(files, options);

  // Find main entry point (main.js, index.js, or file with function main())
  const mainFilename = findMainFilename(files);

  let mainRust = '';

  // Build hierarchical module tree
  const rootModule = { children: {} };

  for (const rawPath of filenames) {
    const norm = normalizePath(rawPath);
    const code = files[rawPath];

    if (rawPath === mainFilename) {
      // Transpile main file (this will automatically convert `import` to `use path::item;`)
      mainRust = transpile(code, moduleOptions);
    } else {
      // It's a module file (may be inside nested folders like utils/math.js)
      const parts = norm
        .replace(/\.(js|ts|mjs)$/, '')
        .split('/')
        .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));

      const compiledCode = transpile(code, moduleOptions);

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

  let finalOutput = '#![allow(unused_imports, unused_variables, dead_code)]\n\n';
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

  const moduleOptions = collectCrossModuleMetadata(files, options);

  const project = {};

  // 1. Cargo.toml (Include tokio if async/await is detected)
  const hasAsync = Object.values(files).some((code) => /\basync\s+function\b|\bawait\b/.test(code));
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

  for (const rawPath of filenames) {
    if (rawPath === mainFilename) continue;

    const norm = normalizePath(rawPath);
    const parts = norm
      .replace(/\.(js|ts|mjs)$/, '')
      .split('/')
      .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));

    const code = files[rawPath];
    const compiledCode = transpile(code, moduleOptions);

    // rustFilePath: e.g. 'src/utils/math.rs'
    const rustFilePath = `src/${parts.join('/')}.rs`;
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
    project[modRsPath] = modContent;
  }

  // 3. Generate src/main.rs
  const mainJsCode = files[mainFilename] || '';
  const mainCompiled = transpile(mainJsCode, moduleOptions);

  let mainRsHeader = '#![allow(unused_imports, unused_variables, dead_code)]\n\n';
  if (topLevelMods.size > 0) {
    const sortedTopMods = Array.from(topLevelMods).sort();
    mainRsHeader += sortedTopMods.map((m) => `mod ${m};`).join('\n') + '\n\n';
  }

  project['src/main.rs'] = `${mainRsHeader}${mainCompiled}`.trim() + '\n';

  return project;
}
