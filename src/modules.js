/**
 * Module System Transpiler for js-to-rust
 * Handles ES Modules (import / export) and bundles multi-file modules into Rust's module hierarchy (pub mod xxx).
 */

import { transpile } from './index.js';

/**
 * Transpiles multiple JavaScript files into a single cohesive Rust program.
 * @param {Record<string, string>} files - Map of filename to JS source code.
 * @param {object} [options] - Compiler options.
 * @returns {string} - The combined Rust source code.
 */
export function transpileMultiModules(files, options = {}) {
  const filenames = Object.keys(files);

  // If only one file or no modules, transpile directly
  if (filenames.length <= 1) {
    const singleCode = files['main.js'] || Object.values(files)[0] || '';
    return transpile(singleCode, options);
  }

  let modulesRust = '';
  let importsRust = '';
  let mainRust = '';

  const mainFilename = filenames.find((f) => f === 'main.js') || filenames[0];

  for (const filename of filenames) {
    const code = files[filename];

    if (filename === mainFilename) {
      // Process main file
      mainRust = transpile(code, options);

      // Convert ES module imports to Rust `use` statements
      // e.g. import { add, sub } from './math.js'; -> use math::add; use math::sub;
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        const symbols = match[1].split(',').map((s) => s.trim()).filter(Boolean);
        const rawModName = match[2].replace(/\.(js|ts|mjs)$/, '');
        for (const sym of symbols) {
          importsRust += `use ${rawModName}::${sym};\n`;
        }
      }
    } else {
      // Process module file
      const modName = filename.replace(/\.(js|ts|mjs)$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
      const compiledModCode = transpile(code, options);

      // Indent module body
      const indented = compiledModCode
        .split('\n')
        .map((line) => (line.trim() ? `    ${line}` : ''))
        .join('\n');

      modulesRust += `pub mod ${modName} {\n${indented}\n}\n\n`;
    }
  }

  let finalOutput = '';
  if (modulesRust) {
    finalOutput += `// === Modules ===\n${modulesRust}`;
  }
  if (importsRust) {
    finalOutput += `// === Module Imports ===\n${importsRust}\n`;
  }
  finalOutput += `// === Main Application ===\n${mainRust}`;

  return finalOutput.trim() + '\n';
}
