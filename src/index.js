/**
 * Main Entry Point for js-to-rust
 */

import { RustEmitter } from './codegen.js';
import { transpileMultiModules, generateRustProject } from './modules.js';
import { analyzeJavaScript, assertValid } from './validation.js';

/**
 * Transpiles JavaScript source code to Rust source code.
 * @param {string} jsCode - The JavaScript source code.
 * @param {object} [options] - Compiler options.
 * @returns {string} - The resulting Rust source code.
 */
export function transpile(jsCode, options = {}) {
  const analysis = analyzeJavaScript(jsCode, options);
  assertValid(analysis);

  const emitter = new RustEmitter(options);
  const rustCode = emitter.emitProgramWithAst(analysis.ast);

  return rustCode.trim() + '\n';
}

export { transpileMultiModules, generateRustProject };
export { validateJavaScript, validateProject, JavaScriptValidationError } from './validation.js';
export default transpile;
