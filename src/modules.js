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

  // Find main entry point (main.js or src/main.js)
  const mainFilename =
    filenames.find((f) => normalizePath(f) === 'main.js') || filenames[0];

  let mainRust = '';
  let importsRust = '';

  // Build hierarchical module tree
  const rootModule = { children: {} };

  for (const rawPath of filenames) {
    const norm = normalizePath(rawPath);
    const code = files[rawPath];

    if (rawPath === mainFilename) {
      mainRust = transpile(code, options);

      // Convert ES module imports to Rust `use` statements
      // e.g. import { add } from './utils/math.js'; -> use utils::math::add;
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        const symbols = match[1].split(',').map((s) => s.trim()).filter(Boolean);
        const importPath = normalizePath(match[2]).replace(/\.(js|ts|mjs)$/, '');
        const rustModPath = importPath.split('/').map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_')).join('::');

        for (const sym of symbols) {
          importsRust += `use ${rustModPath}::${sym};\n`;
        }
      }
    } else {
      // It's a module file (may be in a folder like utils/math.js)
      const parts = norm.replace(/\.(js|ts|mjs)$/, '').split('/').map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'));
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
  if (importsRust) {
    finalOutput += `// === Module Imports ===\n${importsRust}\n`;
  }
  finalOutput += `// === Main Application ===\n${mainRust}`;

  return finalOutput.trim() + '\n';
}
