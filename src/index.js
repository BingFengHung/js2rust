/**
 * Main Entry Point for js-to-rust
 */

import { parse } from '@babel/parser';
import { RustEmitter } from './codegen.js';

/**
 * Transpiles JavaScript source code to Rust source code.
 * @param {string} jsCode - The JavaScript source code.
 * @param {object} [options] - Compiler options.
 * @returns {string} - The resulting Rust source code.
 */
export function transpile(jsCode, options = {}) {
  // Parse JavaScript with Babel, preserving comments (needed for JSDoc)
  const ast = parse(jsCode, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    plugins: [
      'classProperties',
      'numericSeparator',
    ],
  });

  const emitter = new RustEmitter(options);
  const rustCode = emitter.emit(ast.program);

  return rustCode.trim() + '\n';
}

export default transpile;
