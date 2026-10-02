/**
 * Main Entry Point for js-to-rust
 */

import { parse } from '@babel/parser';
import { RustEmitter } from './codegen.js';
import { transpileMultiModules, generateRustProject } from './modules.js';

/**
 * Transpiles JavaScript source code to Rust source code.
 * @param {string} jsCode - The JavaScript source code.
 * @param {object} [options] - Compiler options.
 * @returns {string} - The resulting Rust source code.
 */
export function transpile(jsCode, options = {}) {
  // Parse JavaScript with Babel, preserving all comments (needed for JSDoc & typedefs)
  const ast = parse(jsCode, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    plugins: [
      'classProperties',
      'numericSeparator',
      'typescript',
    ],
  });

  const emitter = new RustEmitter(options);
  const rustCode = emitter.emitProgramWithAst(ast);

  return rustCode.trim() + '\n';
}

export { transpileMultiModules, generateRustProject };
export default transpile;
