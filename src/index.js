/**
 * Main Entry Point for js-to-rust
 */

import { RustEmitter } from './codegen.js';
import { transpileMultiModules, generateRustProject } from './modules.js';
import { analyzeJavaScript, assertValid } from './validation.js';
import { createMappingSession, extractSourceMap } from './source-map.js';

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

export function transpileWithSourceMap(source, options = {}) {
  const session = createMappingSession();
  return extractSourceMap(transpile(source, { ...options, sourceMapSession: session }), session, options.generatedFile);
}
export function transpileMultiModulesWithSourceMap(files, options = {}) {
  const session = createMappingSession();
  return extractSourceMap(transpileMultiModules(files, { ...options, sourceMapSession: session }), session, options.generatedFile);
}
export function generateRustProjectWithSourceMap(files, options = {}) {
  const session = createMappingSession();
  const marked = generateRustProject(files, { ...options, sourceMapSession: session });
  const projectFiles = {}, sourceMaps = {};
  for (const [filename, content] of Object.entries(marked)) {
    const result = extractSourceMap(content, session, filename);
    projectFiles[filename] = result.code;
    if (filename.endsWith('.rs')) sourceMaps[filename] = result.sourceMap;
  }
  return { projectFiles, sourceMaps };
}
export { mapRustDiagnostics, originalLocation } from './source-map.js';
export { prepareComparison, parseComparisonOutput } from './comparison.js';
