/**
 * Module System Transpiler for js-to-rust
 * Handles ES Modules (import / export) and bundles multi-file & nested folders into Rust's module hierarchy.
 */

import { transpile } from './index.js';

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
      mainRust = transpile(code, options);
    } else {
      // It's a module file (may be inside nested folders like utils/math.js)
      const parts = norm
        .replace(/\.(js|ts|mjs)$/, '')
        .split('/')
        .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));

      const compiledCode = transpile(code, options);

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

  let finalOutput = '';
  if (modulesRust.trim()) {
    finalOutput += `// === Modules & Nested Folders ===\n${modulesRust}`;
  }
  finalOutput += `// === Main Application ===\n${mainRust}`;

  return finalOutput.trim() + '\n';
}
