/**
 * Advanced Code Generator: Converts AST nodes to formatted, idiomatic Rust.
 */

import { parseJSDoc, mapToRustType } from './types.js';
import { inferParameterType } from './inference.js';
import { RUST_RUNTIME } from './runtime.js';
import path from 'node:path';

function writesIdentifier(node, name) {
  if (!node || typeof node !== 'object') return false;
  const target = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : null;
  if (target && (target.name === name || target.object?.name === name)) return true;
  if (node.type === 'CallExpression' && node.callee.object?.name === name &&
      ['push', 'pop', 'splice', 'sort', 'reverse'].includes(node.callee.property?.name)) return true;
  return Object.entries(node).some(([key, value]) => !key.endsWith('Comments') &&
    (Array.isArray(value) ? value.some(child => writesIdentifier(child, name)) : writesIdentifier(value, name)));
}

export function doesMethodMutateThis(bodyNode) {
  let mutates = false;
  const check = (node) => {
    if (!node || typeof node !== 'object' || mutates) return;

    if (node.type === 'AssignmentExpression') {
      if (
        node.left.type === 'MemberExpression' &&
        node.left.object.type === 'ThisExpression'
      ) {
        mutates = true;
        return;
      }
    }

    if (node.type === 'UpdateExpression') {
      if (
        node.argument.type === 'MemberExpression' &&
        node.argument.object.type === 'ThisExpression'
      ) {
        mutates = true;
        return;
      }
    }

    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'MemberExpression' &&
      node.callee.object.object.type === 'ThisExpression'
    ) {
      const method = node.callee.property.name;
      if (['push', 'pop', 'reverse', 'sort', 'splice'].includes(method)) {
        mutates = true;
        return;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(check);
      } else if (child && typeof child === 'object') {
        check(child);
      }
    }
  };

  check(bodyNode);
  return mutates;
}

export class RustEmitter {
  constructor(options = {}) {
    this.indentSize = options.indentSize || 4;
    this.indentLevel = 0;
    this.defaultNumberType = options.defaultNumberType || 'i64';
    this.signatures = new Map(options.sharedSignatures || []); // fnName -> Array<{ name: string, type: string, isMut: boolean, isStruct: boolean }>
    this.structs = new Map(options.sharedStructs || []);    // structName -> Array<{ name: string, type: string }>
    this.rootAst = null;
    this.needThread = false;
    this.needDuration = false;
    this.needMpsc = false;
    this.needArcMutex = false;
    this.classes = new Set(options.sharedClasses || []);
    this.classMutatingMethods = new Set(options.sharedMutatingMethods || []);
    this.mutatedVars = new Set();
    this.enums = new Set(options.sharedEnums || []);
    this.options = options;
    this.scopes = [new Map()];
    this.returnTypes = new Map(options.sharedReturnTypes || []);
    this.currentReturnType = null;
    this.currentClass = null;
    this.needRuntime = false;
    this.forUpdates = [];
    this.switchCounter = 0;
    this.breakTargets = [];
  }

  fail(node, message) {
    const where = node?.loc ? ` (${this.options.filename || 'source'}:${node.loc.start.line}:${node.loc.start.column + 1})` : '';
    throw new Error(`${message}${where}`);
  }

  withScope(bindings, fn) {
    this.scopes.push(new Map(bindings));
    try { return fn(); } finally { this.scopes.pop(); }
  }

  variableType(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return null;
  }

  isString(type) { return type === 'String' || Boolean(type?.includes('str')); }
  isFloat(type) { return type === 'f64' || type === 'f32'; }
  elementType(type) {
    return type?.match(/^(?:Vec<|&(?:mut )?Vec<)(.+)>$/)?.[1]
      || type?.match(/^&(?:mut )?\[(.+)\]$/)?.[1] || null;
  }

  inferExpressionType(node) {
    if (!node) return null;
    switch (node.type) {
      case 'NumericLiteral': return Number.isInteger(node.value) ? this.defaultNumberType : 'f64';
      case 'StringLiteral': return '&str';
      case 'TemplateLiteral': return 'String';
      case 'BooleanLiteral': return 'bool';
      case 'Identifier':
        if (['NaN', 'Infinity'].includes(node.name)) return 'f64';
        return this.variableType(node.name);
      case 'ArrayExpression': {
        const types = node.elements.map(e => this.inferExpressionType(e));
        if (types.some(t => this.isString(t))) return 'Vec<String>';
        return `Vec<${types.some(t => this.isFloat(t)) ? 'f64' : types[0] || this.defaultNumberType}>`;
      }
      case 'NewExpression': return node.callee.name === 'Promise' ? null : node.callee.name;
      case 'UnaryExpression': return node.operator === '!' ? 'bool' : this.inferExpressionType(node.argument);
      case 'LogicalExpression': return 'bool';
      case 'ConditionalExpression': return this.inferExpressionType(node.consequent) || this.inferExpressionType(node.alternate);
      case 'BinaryExpression': {
        if (['==', '===', '!=', '!==', '<', '<=', '>', '>=', 'in', 'instanceof'].includes(node.operator)) return 'bool';
        const left = this.inferExpressionType(node.left), right = this.inferExpressionType(node.right);
        if (node.operator === '+' && (this.isString(left) || this.isString(right))) return 'String';
        if (node.operator === '/' || node.operator === '**' || this.isFloat(left) || this.isFloat(right)) return 'f64';
        return left || right || this.defaultNumberType;
      }
      case 'MemberExpression': {
        if (node.property.name === 'length') return 'i64';
        const objectType = node.object.type === 'ThisExpression' ? this.currentClass : this.inferExpressionType(node.object);
        if (node.computed) return this.elementType(objectType);
        const struct = this.structs.get(objectType?.replace(/^&(?:mut )?/, ''));
        return struct?.find(p => p.name === node.property.name)?.type || null;
      }
      case 'AwaitExpression': return this.inferExpressionType(node.argument);
      case 'CallExpression': {
        if (node.callee.type === 'Identifier') return this.returnTypes.get(node.callee.name) || null;
        if (node.callee.type !== 'MemberExpression') return null;
        const method = node.callee.property.name;
        const objectType = this.inferExpressionType(node.callee.object);
        const element = this.elementType(objectType) || this.defaultNumberType;
        if (node.callee.object.name === 'Math') return ['sqrt', 'pow'].includes(method) ? 'f64' : method === 'floor' ? 'i64' : this.inferExpressionType(node.arguments[0]);
        if (['includes', 'some', 'every', 'startsWith', 'endsWith'].includes(method)) return 'bool';
        if (method === 'split') return 'Vec<String>';
        if (['join', 'trim', 'toLowerCase', 'toUpperCase'].includes(method)) return 'String';
        if (['slice', 'splice', 'filter', 'reverse', 'sort', 'concat'].includes(method)) return `Vec<${element}>`;
        if (method === 'map') {
          const callback = node.arguments[0];
          const result = this.inferCallbackResult(callback, [element, 'i64']);
          return `Vec<${this.isString(result) ? 'String' : result || element}>`;
        }
        if (method === 'reduce') {
          const initial = node.arguments.length > 1 ? this.inferExpressionType(node.arguments[1]) : element;
          return this.inferCallbackResult(node.arguments[0], [initial, element, 'i64']) || initial;
        }
        if (['pop', 'find'].includes(method)) return `Option<${element}>`;
        if (['push', 'indexOf'].includes(method)) return 'i64';
        return null;
      }
      default: return null;
    }
  }

  inferCallbackResult(node, types) {
    if (!node || !['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return null;
    return this.withScope(node.params.map((p, i) => [p.name, types[i]]), () =>
      node.body.type === 'BlockStatement' ? this.inferBlockReturnType(node.body) || '()' : this.inferExpressionType(node.body));
  }

  registerLocals(block) {
    const scan = node => {
      if (!node || typeof node !== 'object') return;
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration'].includes(node.type)) return;
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        this.scopes.at(-1).set(node.id.name, this.inferExpressionType(node.init));
      }
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'leadingComments', 'trailingComments'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(scan);
        else if (value && typeof value === 'object') scan(value);
      }
    };
    scan(block);
  }

  rustString(value) {
    return '"' + Array.from(value).map(c => {
      if (c === '"') return '\\"';
      if (c === '\\') return '\\\\';
      if (c === '\n') return '\\n';
      if (c === '\r') return '\\r';
      if (c === '\t') return '\\t';
      const cp = c.codePointAt(0);
      if (cp >= 0xd800 && cp <= 0xdfff) throw new Error('Lone UTF-16 surrogates are unsupported');
      return cp < 32 ? `\\u{${cp.toString(16)}}` : c;
    }).join('') + '"';
  }

  emitExpected(node, type) {
    const code = this.emit(node);
    const actual = this.inferExpressionType(node);
    if (type === 'String' && this.isString(actual) && actual !== 'String') return `(${code}).to_string()`;
    if (this.isFloat(type) && actual !== type) return `((${code}) as ${type})`;
    if (type?.includes('str') && actual === 'String') return `&(${code})`;
    return code;
  }

  helper(name) { this.needRuntime = true; return `__js2rust::${name}`; }

  isHandleArray(name) {
    let unknownPush = false;
    const scan = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.object?.name === name && node.callee.property?.name === 'push') {
        if (!this.inferExpressionType(node.arguments[0])) unknownPush = true;
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'leadingComments', 'trailingComments'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(scan);
        else if (child && typeof child === 'object') scan(child);
      }
    };
    scan(this.rootAst?.program);
    return unknownPush;
  }

  inferEmptyElement(name) {
    let result = null;
    const scan = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.object?.name === name) {
        const method = node.callee.property?.name;
        const values = method === 'push' ? node.arguments : method === 'splice' ? node.arguments.slice(2) : [];
        for (const value of values) {
          const type = this.inferExpressionType(value);
          if (type) result = this.isString(type) ? 'String' : this.isFloat(type) ? 'f64' : result || type;
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'leadingComments', 'trailingComments'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(scan);
        else if (child && typeof child === 'object') scan(child);
      }
    };
    scan(this.rootAst?.program);
    return result;
  }

  mapTsType(tsType) {
    if (!tsType) return this.defaultNumberType;
    switch (tsType.type) {
      case 'TSStringKeyword':
        return 'String';
      case 'TSNumberKeyword':
        return 'f64';
      case 'TSBooleanKeyword':
        return 'bool';
      case 'TSVoidKeyword':
        return '';
      case 'TSTypeReference':
        return tsType.typeName.name;
      case 'TSArrayType':
        return `Vec<${this.mapTsType(tsType.elementType)}>`;
      default:
        return this.defaultNumberType;
    }
  }

  inferBlockReturnType(blockNode) {
    if (!blockNode) return null;
    this.registerLocals(blockNode);
    let inferredType = null;

    const scan = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node !== blockNode && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
      if (node.type === 'ReturnStatement' && node.argument) {
        const arg = node.argument;
        const expressionType = this.inferExpressionType(arg);
        if (expressionType) {
          const next = this.isString(expressionType) ? 'String' : expressionType;
          if (inferredType && inferredType !== next && !(['i64', 'f64'].includes(inferredType) && ['i64', 'f64'].includes(next))) {
            this.fail(node, `Conflicting return types: ${inferredType} and ${next}`);
          }
          inferredType = inferredType === 'f64' || next === 'f64' ? 'f64' : next;
        } else if (arg.type === 'BooleanLiteral') {
          inferredType = 'bool';
        } else if (
          arg.type === 'BinaryExpression' &&
          ['==', '===', '!=', '!==', '<', '<=', '>', '>=', '&&', '||'].includes(arg.operator)
        ) {
          inferredType = 'bool';
        } else if (arg.type === 'UnaryExpression' && arg.operator === '!') {
          inferredType = 'bool';
        } else if (arg.type === 'LogicalExpression' && ['&&', '||'].includes(arg.operator)) {
          inferredType = 'bool';
        } else if (arg.type === 'StringLiteral' || arg.type === 'TemplateLiteral') {
          inferredType = 'String';
        } else if (arg.type === 'NumericLiteral') {
          inferredType = Number.isInteger(arg.value) ? this.defaultNumberType : 'f64';
        } else if (arg.type === 'ArrayExpression') {
          inferredType = 'Vec<i64>';
        } else if (arg.type === 'NewExpression' && arg.callee && arg.callee.name === 'Promise') {
          const pScan = (pn) => {
            if (!pn || typeof pn !== 'object' || inferredType) return;
            if (pn.type === 'CallExpression' && pn.arguments && pn.arguments.length > 0) {
              const resArg = pn.arguments[0];
              if (resArg.type === 'StringLiteral' || resArg.type === 'TemplateLiteral') {
                inferredType = 'String';
                return;
              } else if (resArg.type === 'NumericLiteral') {
                inferredType = Number.isInteger(resArg.value) ? this.defaultNumberType : 'f64';
                return;
              } else if (resArg.type === 'BooleanLiteral') {
                inferredType = 'bool';
                return;
              }
            }
            for (const pk of Object.keys(pn)) {
              if (pk === 'leadingComments' || pk === 'trailingComments') continue;
              const child = pn[pk];
              if (Array.isArray(child)) child.forEach(pScan);
              else if (child && typeof child === 'object') pScan(child);
            }
          };
          pScan(arg);
          if (!inferredType) inferredType = '()';
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingComments' || k === 'trailingComments') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(scan);
        else if (child && typeof child === 'object') scan(child);
      }
    };
    scan(blockNode);
    return inferredType;
  }

  hasReturnPromise(blockNode) {
    if (!blockNode) return false;
    let found = false;
    const scan = (node) => {
      if (!node || typeof node !== 'object' || found) return;
      if (
        node.type === 'ReturnStatement' &&
        node.argument &&
        node.argument.type === 'NewExpression' &&
        node.argument.callee &&
        node.argument.callee.name === 'Promise'
      ) {
        found = true;
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingComments' || k === 'trailingComments') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(scan);
        else if (child && typeof child === 'object') scan(child);
      }
    };
    scan(blockNode);
    return found;
  }

  emitPromise(newExpr) {
    if (!newExpr.arguments || newExpr.arguments.length === 0) return '';
    const executor = newExpr.arguments[0];
    if (executor.type !== 'ArrowFunctionExpression' && executor.type !== 'FunctionExpression') {
      return '';
    }

    const resolveParam = executor.params[0] ? executor.params[0].name : 'resolve';

    let stmts = [];
    if (executor.body.type === 'BlockStatement') {
      stmts = executor.body.body;
    } else {
      stmts = [{ type: 'ExpressionStatement', expression: executor.body }];
    }

    const outputLines = [];

    for (const s of stmts) {
      if (
        s.type === 'ExpressionStatement' &&
        s.expression.type === 'CallExpression' &&
        s.expression.callee.name === 'setTimeout'
      ) {
        const timeoutArgs = s.expression.arguments;
        const cb = timeoutArgs[0];
        const msNode = timeoutArgs[1];
        const ms = msNode ? this.emit(msNode) : '0';

        outputLines.push(`${this.indent()}tokio::time::sleep(std::time::Duration::from_millis(${ms})).await;`);

        if (cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')) {
          let cbStmts = [];
          if (cb.body.type === 'BlockStatement') {
            cbStmts = cb.body.body;
          } else {
            cbStmts = [{ type: 'ExpressionStatement', expression: cb.body }];
          }

          for (const cbs of cbStmts) {
            if (
              cbs.type === 'ExpressionStatement' &&
              cbs.expression.type === 'CallExpression' &&
              cbs.expression.callee.name === resolveParam
            ) {
              const resVal = cbs.expression.arguments[0];
              if (resVal) {
                let valCode = this.emit(resVal);
                if (resVal.type === 'StringLiteral') {
                  valCode = `"${resVal.value}".to_string()`;
                }
                outputLines.push(`${this.indent()}return ${valCode};`);
              } else {
                outputLines.push(`${this.indent()}return;`);
              }
            } else {
              outputLines.push(this.emit(cbs));
            }
          }
        }
      } else if (
        s.type === 'ExpressionStatement' &&
        s.expression.type === 'CallExpression' &&
        s.expression.callee.name === resolveParam
      ) {
        const resVal = s.expression.arguments[0];
        if (resVal) {
          let valCode = this.emit(resVal);
          if (resVal.type === 'StringLiteral') {
            valCode = `"${resVal.value}".to_string()`;
          }
          outputLines.push(`${this.indent()}return ${valCode};`);
        } else {
          outputLines.push(`${this.indent()}return;`);
        }
      } else {
        outputLines.push(this.emit(s));
      }
    }

    return outputLines.join('\n');
  }

  formatIdentifier(name) {
    const RUST_KEYWORDS = new Set([
      'type', 'move', 'match', 'fn', 'loop', 'in', 'ref', 'trait', 'impl',
      'where', 'struct', 'enum', 'union', 'mod', 'crate', 'pub', 'box', 'yield'
    ]);
    if (RUST_KEYWORDS.has(name)) {
      return `r#${name}`;
    }
    return name;
  }

  doesMethodMutateThis(bodyNode) {
    return doesMethodMutateThis(bodyNode);
  }

  collectClasses(programNode) {
    if (!programNode || !programNode.body) return;
    if (!this.classes) this.classes = new Set();
    if (!this.classMutatingMethods) this.classMutatingMethods = new Set();

    for (let stmt of programNode.body) {
      if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration) {
        stmt = stmt.declaration;
      }

      if (stmt.type === 'ClassDeclaration') {
        const className = stmt.id ? stmt.id.name : 'Anonymous';
        this.classes.add(className);

        const methods = stmt.body.body.filter(
          (m) => m.type === 'ClassMethod' && m.kind === 'method'
        );

        for (const method of methods) {
          if (this.doesMethodMutateThis(method.body)) {
            this.classMutatingMethods.add(method.key.name);
          }
        }
      }

      if (stmt.type === 'TSEnumDeclaration') {
        this.enums.add(stmt.id.name);
      }
    }
  }

  collectMutatedVars(programNode) {
    this.mutatedVars = new Set();
    const check = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
        this.mutatedVars.add(node.left.name);
      }
      if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') {
        this.mutatedVars.add(node.argument.name);
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const method = node.callee.property.name;
        if (
          ['push', 'pop', 'reverse', 'sort', 'splice'].includes(method) ||
          (this.classMutatingMethods && this.classMutatingMethods.has(method))
        ) {
          if (node.callee.object.type === 'Identifier') {
            this.mutatedVars.add(node.callee.object.name);
          }
        }
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        const fnName = node.callee.name;
        const expectedParamInfos = this.signatures.get(fnName);
        if (expectedParamInfos) {
          node.arguments.forEach((arg, idx) => {
            if (arg.type === 'Identifier' && expectedParamInfos[idx] && expectedParamInfos[idx].isMut) {
              this.mutatedVars.add(arg.name);
            }
          });
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingComments' || k === 'trailingComments') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(check);
        else if (child && typeof child === 'object') check(child);
      }
    };
    check(programNode);
  }

  indent() {
    return ' '.repeat(this.indentLevel * this.indentSize);
  }

  withIndent(fn) {
    this.indentLevel++;
    const res = fn();
    this.indentLevel--;
    return res;
  }

  /**
   * Scans all comments in AST for @typedef structs
   */
  collectTypeDefs(comments = []) {
    for (const comment of comments) {
      if (comment.type === 'CommentBlock' && comment.value.startsWith('*')) {
        const parsed = parseJSDoc([comment]);
        if (parsed.typedef) {
          this.structs.set(parsed.typedef.name, parsed.typedef.properties);
        }
      }
    }
  }

  /**
   * Collects function signatures and runs static analysis for parameter mutability (&mut)
   * and runs smart type inference when JSDoc is not provided.
   */
  collectSignatures(programNode, ast) {
    if (!programNode || !programNode.body) return;

    for (let stmt of programNode.body) {
      // Unwrap ExportNamedDeclaration or ExportDefaultDeclaration if present
      if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') && stmt.declaration) {
        stmt = stmt.declaration;
      }

      if (stmt.type === 'FunctionDeclaration') {
        const fnName = stmt.id?.name || 'default_export';
        const jsdoc = parseJSDoc(stmt.leadingComments);
        const mutatedParams = this.findMutatedParams(stmt);

        const paramInfos = stmt.params.map((param, paramIdx) => {
          const name = param.type === 'AssignmentPattern' ? param.left.name : param.name;
          const isMut = mutatedParams.has(name);

          // 1. Try JSDoc first
          let rawType = param.typeAnnotation ? this.mapTsType(param.typeAnnotation.typeAnnotation) : jsdoc.params[name];

          // 2. If no JSDoc, run Smart Type Inference!
          if (!rawType) {
            rawType = inferParameterType(fnName, paramIdx, name, param, stmt, ast);
          }

          if (!rawType) {
            const fields = new Set();
            const scan = n => {
              if (!n || typeof n !== 'object') return;
              if (n.type === 'MemberExpression' && n.object.name === name && !n.computed) fields.add(n.property.name);
              for (const [k, c] of Object.entries(n)) {
                if (['loc', 'leadingComments', 'trailingComments'].includes(k)) continue;
                if (Array.isArray(c)) c.forEach(scan);
                else if (c && typeof c === 'object') scan(c);
              }
            };
            scan(stmt.body);
            const matches = [...this.structs].filter(([, props]) => fields.size && [...fields].every(f => props.some(p => p.name === f)));
            if (matches.length === 1) rawType = matches[0][0];
          }

          // 3. Fallback
          if (!rawType) {
            rawType = this.defaultNumberType;
          }

          let isStruct = false;
          let rustType = '';

          if (this.structs.has(rawType)) {
            isStruct = true;
            rustType = isMut ? `&mut ${rawType}` : `&${rawType}`;
          } else {
            rustType = mapToRustType(rawType, false, isMut);
          }

          return { name, type: rustType, isMut, isStruct, defaultValue: param.type === 'AssignmentPattern' ? param.right : null };
        });

        this.signatures.set(fnName, paramInfos);
      }
    }
    // Resolve return types before emitting callers, including forward references.
    for (let pass = 0; pass < 3; pass++) {
      for (let stmt of programNode.body) {
        if (stmt.declaration) stmt = stmt.declaration;
        if (stmt.type !== 'FunctionDeclaration') continue;
        const name = stmt.id?.name || 'default_export';
        const doc = parseJSDoc(stmt.leadingComments);
        const params = this.signatures.get(name) || [];
        const result = doc.returns ? mapToRustType(doc.returns, true)
          : stmt.returnType ? this.mapTsType(stmt.returnType.typeAnnotation)
          : this.withScope(params.map(p => [p.name, p.type]), () => this.inferBlockReturnType(stmt.body));
        this.returnTypes.set(name, result || '()');
      }
    }
  }

  /**
   * Static analysis: detects whether a parameter is mutated within the function body
   */
  findMutatedParams(fnNode) {
    const mutated = new Set();
    const paramNames = new Set(
      fnNode.params.map((p) => (p.type === 'AssignmentPattern' ? p.left.name : p.name))
    );

    const checkNode = (node) => {
      if (!node || typeof node !== 'object') return;

      // 1. Assignment: arr[i] = val OR arr = val
      if (node.type === 'AssignmentExpression') {
        if (node.left.type === 'Identifier' && paramNames.has(node.left.name)) {
          mutated.add(node.left.name);
        } else if (node.left.type === 'MemberExpression') {
          let curr = node.left.object;
          while (curr && curr.type === 'MemberExpression') curr = curr.object;
          if (curr && curr.type === 'Identifier' && paramNames.has(curr.name)) {
            mutated.add(curr.name);
          }
        }
      }

      // 2. UpdateExpression: arr[i]++ or i++
      if (node.type === 'UpdateExpression') {
        let curr = node.argument;
        while (curr && curr.type === 'MemberExpression') curr = curr.object;
        if (curr && curr.type === 'Identifier' && paramNames.has(curr.name)) {
          mutated.add(curr.name);
        }
      }

      // 3. Mutating methods: arr.push(), arr.pop()
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const method = node.callee.property.name;
        if (['push', 'pop', 'reverse', 'sort', 'splice'].includes(method)) {
          const obj = node.callee.object;
          if (obj.type === 'Identifier' && paramNames.has(obj.name)) {
            mutated.add(obj.name);
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'leadingComments' || key === 'trailingComments') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(checkNode);
        } else if (child && typeof child === 'object') {
          checkNode(child);
        }
      }
    };

    if (fnNode.body) {
      checkNode(fnNode.body);
    }

    return mutated;
  }

  emitProgramWithAst(ast) {
    this.collectTypeDefs(ast.comments || []);
    this.rootAst = ast;
    return this.emitProgram(ast.program);
  }

  emit(node) {
    if (!node) return '';

    switch (node.type) {
      case 'Program':
        return this.emitProgram(node);

      case 'ExportNamedDeclaration':
        return this.emit(node.declaration);

      case 'ExportDefaultDeclaration':
        return this.emitExportDefaultDeclaration(node);

      case 'ClassDeclaration':
        return this.emitClassDeclaration(node);

      case 'TSEnumDeclaration':
        return this.emitTSEnumDeclaration(node);

      case 'TSInterfaceDeclaration':
        return this.emitTSInterfaceDeclaration(node);

      case 'ImportDeclaration':
        return this.emitImportDeclaration(node);

      case 'FunctionDeclaration':
        return this.emitFunctionDeclaration(node);

      case 'BlockStatement':
        return this.emitBlockStatement(node);

      case 'VariableDeclaration':
        return this.emitVariableDeclaration(node);

      case 'IfStatement':
        return this.emitIfStatement(node);

      case 'SwitchStatement':
        return this.emitSwitchStatement(node);

      case 'WhileStatement':
        return this.emitWhileStatement(node);

      case 'ForStatement':
        return this.emitForStatement(node);

      case 'ForOfStatement':
        return this.emitForOfStatement(node);

      case 'BreakStatement':
        return `${this.indent()}break${this.breakTargets.at(-1) ? ` '${this.breakTargets.at(-1)}` : ''};`;

      case 'ContinueStatement':
        return `${this.forUpdates.at(-1) ? `${this.indent()}${this.forUpdates.at(-1)};\n` : ''}${this.indent()}continue;`;

      case 'ReturnStatement':
        if (node.argument && node.argument.type === 'NewExpression' && node.argument.callee && node.argument.callee.name === 'Promise') {
          return this.emitPromise(node.argument);
        }
        return `${this.indent()}return ${node.argument ? this.emitExpected(node.argument, this.currentReturnType) : ''};`;

      case 'ExpressionStatement':
        return `${this.indent()}${this.emit(node.expression)};`;

      case 'BinaryExpression':
      case 'LogicalExpression':
        return this.emitBinaryExpression(node);

      case 'UnaryExpression':
        if (!['!', '-', '+', '~'].includes(node.operator)) this.fail(node, `Unsupported unary operator: ${node.operator}`);
        return node.operator === '+' ? `(${this.emit(node.argument)})` : `(${node.operator === '~' ? '!' : node.operator}${this.emit(node.argument)})`;

      case 'UpdateExpression':
        return this.emitUpdateExpression(node);

      case 'AssignmentExpression':
        return `${this.emit(node.left)} ${node.operator} ${this.emit(node.right)}`;

      case 'ConditionalExpression':
        return `if ${this.emit(node.test)} { ${this.emit(node.consequent)} } else { ${this.emit(node.alternate)} }`;

      case 'CallExpression':
        return this.emitCallExpression(node);

      case 'MemberExpression':
        return this.emitMemberExpression(node);

      case 'ArrayExpression':
        if (node.elements.some(e => !e)) this.fail(node, 'Sparse arrays are unsupported');
        if (node.elements.some(e => {
          const actual = this.inferExpressionType(e);
          const expected = this.elementType(this.inferExpressionType(node));
          return actual && actual !== expected && !(this.isString(actual) && this.isString(expected)) &&
            !(['i64', 'f64'].includes(actual) && ['i64', 'f64'].includes(expected));
        })) this.fail(node, 'Mixed element types in arrays are unsupported');
        return `vec![${node.elements.map((e) => this.emitExpected(e, this.elementType(this.inferExpressionType(node)))).join(', ')}]`;

      case 'ObjectExpression':
        return this.emitObjectExpression(node);

      case 'TemplateLiteral':
        return this.emitTemplateLiteral(node);

      case 'NumericLiteral':
        return String(node.value);

      case 'StringLiteral':
        return this.rustString(node.value);

      case 'BooleanLiteral':
        return node.value ? 'true' : 'false';

      case 'Identifier':
        if (node.name === 'NaN') return 'f64::NAN';
        if (node.name === 'Infinity') return 'f64::INFINITY';
        if (node.name === 'undefined') return 'None';
        return this.formatIdentifier(node.name);

      case 'ThisExpression':
        return 'self';

      case 'NewExpression':
        return this.emitNewExpression(node);

      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return this.emitClosure(node);

      case 'AwaitExpression':
        return `${this.emit(node.argument)}.await`;

      case 'EmptyStatement': return '';

      default:
        this.fail(node, `Unsupported AST node: ${node.type}`);
    }
  }

  emitExportDefaultDeclaration(node) {
    if (node.declaration.type === 'FunctionDeclaration') {
      if (!node.declaration.id) {
        node.declaration.id = { type: 'Identifier', name: 'default_export' };
      }
      return this.emitFunctionDeclaration(node.declaration);
    }
    if (node.declaration.type === 'ClassDeclaration') {
      return this.emitClassDeclaration(node.declaration);
    }
    if (node.declaration.type === 'Identifier') {
      return '';
    }
    return `pub static DEFAULT_EXPORT: &str = ${this.emit(node.declaration)};`;
  }

  emitClassDeclaration(node) {
    const className = node.id ? node.id.name : 'AnonymousClass';

    const ctor = node.body.body.find(
      (m) => m.type === 'ClassMethod' && m.kind === 'constructor'
    );
    const methods = node.body.body.filter(
      (m) => m.type === 'ClassMethod' && m.kind === 'method'
    );

    const fields = new Map();
    const fieldInitializers = new Map();
    const ctorParams = ctor ? ctor.params : [];
    const ctorJsdoc = ctor ? parseJSDoc(ctor.leadingComments) : { params: {}, returns: null };

    // Explicit class properties (e.g. class Foo { count = 0; })
    for (const member of node.body.body) {
      if (member.type === 'ClassProperty' || member.type === 'PropertyDefinition') {
        const propName = member.key.name;
        let propType = this.defaultNumberType;
        if (member.typeAnnotation) {
          propType = this.mapTsType(member.typeAnnotation.typeAnnotation);
        } else if (member.value) {
          if (member.value.type === 'NumericLiteral') {
            propType = Number.isInteger(member.value.value) ? this.defaultNumberType : 'f64';
          } else if (member.value.type === 'StringLiteral') {
            propType = 'String';
          } else if (member.value.type === 'BooleanLiteral') {
            propType = 'bool';
          }
          fieldInitializers.set(propName, member.value);
        }
        fields.set(propName, propType);
      }
    }

    // Inspect constructor assignments: this.x = x
    if (ctor && ctor.body && ctor.body.body) {
      for (const stmt of ctor.body.body) {
        if (
          stmt.type === 'ExpressionStatement' &&
          stmt.expression.type === 'AssignmentExpression' &&
          stmt.expression.left.type === 'MemberExpression' &&
          stmt.expression.left.object.type === 'ThisExpression'
        ) {
          const fieldName = stmt.expression.left.property.name;
          const right = stmt.expression.right;
          fieldInitializers.set(fieldName, right);
          let fieldType = this.defaultNumberType;

          if (right.type === 'Identifier') {
            const paramName = right.name;
            const ctorParam = ctorParams.find((p) => p.name === paramName);
            if (ctorParam && ctorParam.typeAnnotation) {
              fieldType = this.mapTsType(ctorParam.typeAnnotation.typeAnnotation);
            } else if (ctorJsdoc.params[paramName]) {
              fieldType = mapToRustType(ctorJsdoc.params[paramName]);
            } else if (
              paramName.toLowerCase().includes('name') ||
              paramName.toLowerCase().includes('title') ||
              paramName.toLowerCase().includes('str') ||
              paramName.toLowerCase().includes('owner') ||
              paramName.toLowerCase().includes('msg') ||
              paramName.toLowerCase().includes('customer') ||
              paramName.toLowerCase().includes('user') ||
              paramName.toLowerCase().includes('email') ||
              paramName.toLowerCase().includes('text') ||
              paramName.toLowerCase().includes('desc') ||
              paramName.toLowerCase().includes('author') ||
              paramName.toLowerCase().includes('buyer')
            ) {
              fieldType = 'String';
            } else {
              fieldType = this.defaultNumberType;
            }
          } else if (right.type === 'StringLiteral') {
            fieldType = 'String';
          } else if (right.type === 'BooleanLiteral') {
            fieldType = 'bool';
          } else if (right.type === 'NumericLiteral') {
            fieldType = Number.isInteger(right.value) ? this.defaultNumberType : 'f64';
          } else if (right.type === 'MemberExpression') {
            const objName = right.object ? right.object.name : null;
            if (objName && (this.enums.has(objName) || /^[A-Z]/.test(objName))) {
              fieldType = objName;
            }
          }

          fields.set(fieldName, fieldType);
        }
      }
    }

    // Register into this.structs so other parts know it is a struct
    const structProps = [];
    for (const [name, type] of fields.entries()) {
      structProps.push({ name, type });
    }
    this.structs.set(className, structProps);

    // Generate Rust Struct
    let structCode = `${this.indent()}#[derive(Debug, Clone)]\n${this.indent()}pub struct ${className} {\n`;
    this.withIndent(() => {
      for (const [name, type] of fields.entries()) {
        structCode += `${this.indent()}pub ${name}: ${type},\n`;
      }
    });
    structCode += `${this.indent()}}\n\n`;

    // Generate Rust impl block
    let implCode = `${this.indent()}impl ${className} {\n`;

    this.withIndent(() => {
      // Constructor
      if (ctor) {
        const ctorParamDecls = ctorParams.map((p) => {
          const pName = p.name;
          let pType = p.typeAnnotation
            ? this.mapTsType(p.typeAnnotation.typeAnnotation)
            : (ctorJsdoc.params[pName]
                ? mapToRustType(ctorJsdoc.params[pName])
                : (fields.get(pName) || this.defaultNumberType));
          return `${pName}: ${pType}`;
        }).join(', ');

        implCode += `${this.indent()}pub fn new(${ctorParamDecls}) -> Self {\n`;
        this.withIndent(() => {
          implCode += `${this.indent()}Self {\n`;
          this.withIndent(() => {
            for (const [name, type] of fields.entries()) {
              const hasParam = ctorParams.some((p) => p.name === name);
              if (hasParam) {
                implCode += `${this.indent()}${name},\n`;
              } else if (fieldInitializers.has(name)) {
                implCode += `${this.indent()}${name}: ${this.emit(fieldInitializers.get(name))},\n`;
              } else {
                const defaultVal = type === 'String' ? 'String::new()' : (type === 'bool' ? 'false' : (this.enums.has(type) ? `${type}::Default` : '0'));
                implCode += `${this.indent()}${name}: ${defaultVal},\n`;
              }
            }
          });
          implCode += `${this.indent()}}\n`;
        });
        implCode += `${this.indent()}}\n\n`;
      } else {
        implCode += `${this.indent()}pub fn new() -> Self {\n`;
        this.withIndent(() => {
          implCode += `${this.indent()}Self {\n`;
          this.withIndent(() => {
            for (const [name, type] of fields.entries()) {
              if (fieldInitializers.has(name)) {
                implCode += `${this.indent()}${name}: ${this.emit(fieldInitializers.get(name))},\n`;
              } else {
                const defaultVal = type === 'String' ? 'String::new()' : (type === 'bool' ? 'false' : '0');
                implCode += `${this.indent()}${name}: ${defaultVal},\n`;
              }
            }
          });
          implCode += `${this.indent()}}\n`;
        });
        implCode += `${this.indent()}}\n\n`;
      }

      // Methods
      for (const method of methods) {
        const methodName = method.key.name;
        const rustMethodName = this.formatIdentifier(methodName);
        const methodJsdoc = parseJSDoc(method.leadingComments);

        const isMutating = this.doesMethodMutateThis(method.body);
        const selfParam = isMutating ? '&mut self' : '&self';

        const methodParams = method.params.map((p) => {
          const pName = p.name;
          const pType = p.typeAnnotation
            ? this.mapTsType(p.typeAnnotation.typeAnnotation)
            : (methodJsdoc.params[pName]
                ? mapToRustType(methodJsdoc.params[pName])
                : this.defaultNumberType);
          return `${pName}: ${pType}`;
        });

        const allParams = [selfParam, ...methodParams].join(', ');

        const previousClass = this.currentClass;
        this.currentClass = className;
        let returnClause = '';
        if (methodJsdoc.returns && methodJsdoc.returns !== 'void') {
          returnClause = ` -> ${mapToRustType(methodJsdoc.returns, true)}`;
        } else if (method.returnType) {
          const ret = this.mapTsType(method.returnType.typeAnnotation);
          if (ret) returnClause = ` -> ${ret}`;
        } else if (this.hasReturnWithVal(method.body)) {
          const inferred = this.withScope(method.params.map(p => [p.name, p.typeAnnotation ? this.mapTsType(p.typeAnnotation.typeAnnotation) : this.defaultNumberType]), () => this.inferBlockReturnType(method.body));
          returnClause = ` -> ${inferred || this.defaultNumberType}`;
        }

        implCode += `${this.indent()}pub fn ${rustMethodName}(${allParams})${returnClause} `;
        const previousReturn = this.currentReturnType;
        this.currentReturnType = returnClause.replace(/^ -> /, '') || null;
        const bodyStr = this.withScope(method.params.map(p => [p.name, p.typeAnnotation ? this.mapTsType(p.typeAnnotation.typeAnnotation) : this.defaultNumberType]), () => this.emit(method.body));
        this.currentReturnType = previousReturn;
        this.currentClass = previousClass;
        implCode += `${bodyStr}\n\n`;
      }
    });

    implCode = implCode.trimEnd() + `\n${this.indent()}}`;

    // Handle implements clause: class Foo implements Bar
    const implementedTraits = (node.implements || []).map((i) => i.expression.name);
    for (const traitName of implementedTraits) {
      implCode += `\n\n${this.indent()}impl ${traitName} for ${className} {\n`;
      this.withIndent(() => {
        for (const method of methods) {
          const methodName = method.key.name;
          const rustMethodName = this.formatIdentifier(methodName);
          const methodJsdoc = parseJSDoc(method.leadingComments);
          const isMutating = this.doesMethodMutateThis(method.body);
          const selfParam = isMutating ? '&mut self' : '&self';

          const methodParams = method.params.map((p) => {
            const pName = p.name;
            const pType = p.typeAnnotation
              ? this.mapTsType(p.typeAnnotation.typeAnnotation)
              : (methodJsdoc.params[pName]
                  ? mapToRustType(methodJsdoc.params[pName])
                  : this.defaultNumberType);
            return `${pName}: ${pType}`;
          });
          const allParams = [selfParam, ...methodParams].join(', ');

          let returnClause = '';
          if (methodJsdoc.returns && methodJsdoc.returns !== 'void') {
            returnClause = ` -> ${mapToRustType(methodJsdoc.returns, true)}`;
          } else if (method.returnType) {
            const ret = this.mapTsType(method.returnType.typeAnnotation);
            if (ret) returnClause = ` -> ${ret}`;
          } else if (this.hasReturnWithVal(method.body)) {
            const inferred = this.inferBlockReturnType(method.body);
            returnClause = inferred ? ` -> ${inferred}` : ` -> String`;
          }

          implCode += `${this.indent()}fn ${rustMethodName}(${allParams})${returnClause} `;
          const bodyStr = this.emit(method.body);
          implCode += `${bodyStr}\n\n`;
        }
      });
      implCode = implCode.trimEnd() + `\n${this.indent()}}`;
    }

    return structCode + implCode;
  }

  emitTSInterfaceDeclaration(node) {
    const traitName = node.id.name;
    let code = `${this.indent()}pub trait ${traitName} {\n`;
    this.withIndent(() => {
      for (const member of node.body.body) {
        if (member.type === 'TSMethodSignature') {
          const methodName = member.key.name;
          let retClause = ' -> String';
          if (member.typeAnnotation && member.typeAnnotation.typeAnnotation) {
            const rawType = member.typeAnnotation.typeAnnotation.type;
            if (rawType === 'TSNumberKeyword') retClause = ` -> ${this.defaultNumberType}`;
            else if (rawType === 'TSBooleanKeyword') retClause = ' -> bool';
            else if (rawType === 'TSVoidKeyword') retClause = '';
          }
          code += `${this.indent()}fn ${methodName}(&self)${retClause};\n`;
        }
      }
    });
    code += `${this.indent()}}\n`;
    return code;
  }

  emitNewExpression(node) {
    if (node.callee && node.callee.name === 'Promise') {
      return this.emitPromise(node);
    }
    const callee = this.emit(node.callee);
    const args = node.arguments.map((arg) => {
      if (arg.type === 'StringLiteral') {
        return `"${arg.value}".to_string()`;
      }
      return this.emit(arg);
    }).join(', ');
    return `${callee}::new(${args})`;
  }

  emitTSEnumDeclaration(node) {
    const enumName = node.id.name;
    this.enums.add(enumName);
    let code = `${this.indent()}#[derive(Debug, Clone, Copy, PartialEq, Eq)]\n${this.indent()}pub enum ${enumName} {\n`;
    this.withIndent(() => {
      for (const member of node.members) {
        code += `${this.indent()}${member.id.name},\n`;
      }
    });
    code += `${this.indent()}}\n`;
    return code;
  }

  emitClosure(node, isMove = true, isRefParam = false) {
    const params = node.params.map((p) => {
      const pName = p.name || this.emit(p);
      return isRefParam ? `&${pName}` : pName;
    }).join(', ');
    const movePrefix = isMove ? 'move ' : '';
    if (node.body.type === 'BlockStatement') {
      const body = this.emit(node.body);
      return `${movePrefix}|${params}| ${body}`;
    } else {
      const expr = this.emit(node.body);
      return `${movePrefix}|${params}| { ${expr} }`;
    }
  }

  emitArrayCallback(node, types, { indexed = false, reference = false, reduce = false } = {}) {
    if (!node || !['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) {
      this.fail(node, 'Array callbacks currently require an inline arrow function or function expression');
    }
    const max = reduce ? 3 : 2;
    if (node.params.length > max || node.params.some(p => p.type !== 'Identifier')) {
      this.fail(node, `Array callbacks support up to ${max} identifier parameters`);
    }
    const bindings = node.params.map((p, i) => [p.name, types[i]]);
    const resultType = this.inferCallbackResult(node, types);
    const previousReturn = this.currentReturnType;
    this.currentReturnType = this.isString(resultType) ? 'String' : resultType;
    try {
      return this.withScope(bindings, () => {
        this.registerLocals(node.body);
        const declarations = [];
        const valueParam = node.params[reduce ? 1 : 0];
        const indexParam = node.params[reduce ? 2 : 1];
        if (reduce && node.params[0]) declarations.push(`let ${this.formatIdentifier(node.params[0].name)} = __acc;`);
        if (valueParam) declarations.push(`let ${this.formatIdentifier(valueParam.name)} = ${reference ? '(*__value).clone()' : '__value'};`);
        if (indexParam) declarations.push(`let ${this.formatIdentifier(indexParam.name)} = __index as i64;`);
        const params = reduce ? (indexed ? '__acc, (__index, __value)' : '__acc, __value')
          : indexed ? (reference ? '&(__index, ref __value)' : '(__index, __value)') : '__value';
        const body = node.body.type === 'BlockStatement'
          ? this.emit(node.body).trim().slice(1, -1)
          : this.emitExpected(node.body, this.currentReturnType);
        return `|${params}|${this.currentReturnType && this.currentReturnType !== '()' ? ` -> ${this.currentReturnType}` : ''} { ${declarations.join(' ')} ${body} }`;
      });
    } finally { this.currentReturnType = previousReturn; }
  }

  emitImportDeclaration(node) {
    const rawPath = node.source.value;
    if (!rawPath.startsWith('.')) this.fail(node, `Unsupported external module: ${rawPath}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(this.options.filename || 'main.js'), rawPath));
    const cleanPath = resolved
      .replace(/^\.\//, '')
      .replace(/^src\//, '')
      .replace(/\.(js|ts|mjs)$/, '')
      .split('/')
      .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'))
      .join('::');

    const prefix = this.options.filename ? 'crate::' : '';
    const lines = [];
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        const imported = spec.imported.name || spec.imported.value;
        const original = this.options.moduleExports?.get(resolved)?.get(imported) || imported;
        lines.push(`use ${prefix}${cleanPath}::${this.formatIdentifier(original)}${original !== spec.local.name ? ` as ${this.formatIdentifier(spec.local.name)}` : ''};`);
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        this.fail(spec, 'Namespace imports are unsupported; use named imports');
      } else if (spec.type === 'ImportDefaultSpecifier') {
        const exported = this.options.moduleExports?.get(resolved)?.get('default') || spec.local.name;
        lines.push(`use ${prefix}${cleanPath}::${this.formatIdentifier(exported)}${exported !== spec.local.name ? ` as ${this.formatIdentifier(spec.local.name)}` : ''};`);
      }
    }
    return lines.join('\n');
  }

  emitProgram(node) {
    this.collectClasses(node);
    this.collectSignatures(node, this.rootAst);
    this.collectMutatedVars(node);

    const bodyOutput = node.body.map((stmt) => this.emit(stmt)).join('\n\n') + '\n';

    let output = '';

    // Standard Library imports for Concurrency
    if (this.needThread) output += 'use std::thread;\n';
    if (this.needDuration) output += 'use std::time::Duration;\n';
    if (this.needMpsc) output += 'use std::sync::mpsc;\n';
    if (this.needArcMutex) output += 'use std::sync::{Arc, Mutex};\n';
    if (output) output += '\n';
    if (this.needRuntime) output += RUST_RUNTIME + '\n';

    // 1. Emit generated Rust Structs from JSDoc @typedef (excluding classes)
    for (const [name, props] of this.structs.entries()) {
      if (this.classes.has(name)) continue;
      output += `#[derive(Debug, Clone)]\npub struct ${name} {\n`;
      for (const p of props) {
        output += `    pub ${p.name}: ${p.type},\n`;
      }
      output += `}\n\n`;
    }

    // 2. Emit functions and other statements
    output += bodyOutput;
    return output;
  }

  emitFunctionDeclaration(node) {
    const fnName = node.id ? node.id.name : 'default_export';
    const jsdoc = parseJSDoc(node.leadingComments);
    const isMain = fnName === 'main';
    const hasPromiseReturn = this.hasReturnPromise(node.body);
    const isAsync = Boolean(node.async) || hasPromiseReturn;

    const paramInfos = this.signatures.get(fnName) || [];
    const params = paramInfos.map((p) => `${p.isMut && !p.type.startsWith('&mut') ? 'mut ' : ''}${this.formatIdentifier(p.name)}: ${p.type}`).join(', ');

    // Return type
    let returnClause = '';
    if (!isMain && jsdoc.returns && jsdoc.returns !== 'void') {
      const rustRet = mapToRustType(jsdoc.returns, true);
      returnClause = ` -> ${rustRet}`;
    } else if (!isMain && node.returnType) {
      const ret = this.mapTsType(node.returnType.typeAnnotation);
      if (ret) returnClause = ` -> ${ret}`;
    } else if (!isMain && !jsdoc.returns && (this.hasReturnWithVal(node.body) || hasPromiseReturn)) {
      const inferred = this.returnTypes.get(fnName) || this.inferBlockReturnType(node.body);
      if (inferred && inferred !== '()') {
        returnClause = ` -> ${inferred}`;
      } else if (!hasPromiseReturn) {
        returnClause = ` -> ${this.defaultNumberType}`;
      }
    }

    let tokioAttribute = '';
    if (isMain && isAsync) {
      tokioAttribute = `#[tokio::main]\n${this.indent()}`;
    }

    const visibility = isMain ? '' : 'pub ';
    const asyncPrefix = isAsync ? 'async ' : '';
    const lifetimeClause = jsdoc.lifetime ? `<${jsdoc.lifetime}>` : '';
    const header = `${this.indent()}${tokioAttribute}${visibility}${asyncPrefix}fn ${this.formatIdentifier(fnName)}${lifetimeClause}(${params})${returnClause} `;
    const previousReturn = this.currentReturnType;
    this.currentReturnType = returnClause.replace(/^ -> /, '') || null;
    let body;
    try {
      body = this.withScope(paramInfos.map(p => [p.name, p.type]), () => {
        this.registerLocals(node.body);
        return this.emit(node.body);
      });
    } finally { this.currentReturnType = previousReturn; }

    return header + body;
  }

  hasReturnWithVal(blockNode) {
    if (!blockNode) return false;
    let found = false;
    const scan = (node) => {
      if (!node || typeof node !== 'object' || found) return;
      if (node.type === 'ReturnStatement' && node.argument !== null) {
        found = true;
        return;
      }
      if (node !== blockNode && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')) {
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingComments' || k === 'trailingComments') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(scan);
        else if (child && typeof child === 'object') scan(child);
      }
    };
    scan(blockNode);
    return found;
  }

  emitBlockStatement(node) {
    if (!node.body || node.body.length === 0) return '{\n}\n';

    const statements = this.withIndent(() => {
      return node.body.map((stmt) => this.emit(stmt)).join('\n');
    });

    return `{\n${statements}\n${this.indent()}}`;
  }

  emitVariableDeclaration(node) {
    const isConst = node.kind === 'const';
    const decls = node.declarations.map((decl) => {
      let varName = '';
      if (decl.id.type === 'ArrayPattern') {
        const elements = decl.id.elements.map((el) => el.name || this.emit(el)).join(', ');
        varName = `(${elements})`;
      } else {
        if (decl.id.type !== 'Identifier') this.fail(decl, `Unsupported variable binding: ${decl.id.type}`);
        varName = this.formatIdentifier(decl.id.name);
      }
      let needsMut = !isConst;
      if (isConst && decl.id.name && this.mutatedVars && this.mutatedVars.has(decl.id.name)) {
        needsMut = true;
      }
      const mutPrefix = needsMut ? 'let mut ' : 'let ';
      const emptyArray = decl.init?.type === 'ArrayExpression' && decl.init.elements.length === 0;
      const inferredType = emptyArray ? `Vec<${this.inferEmptyElement(decl.id.name) || this.defaultNumberType}>` : this.inferExpressionType(decl.init);
      if (decl.id.name) this.scopes.at(-1).set(decl.id.name, inferredType);
      const initVal = decl.init ? ` = ${this.emit(decl.init)}` : '';
      // Empty arrays used for thread handles must remain inferable from later pushes.
      return `${this.indent()}${mutPrefix}${varName}${inferredType?.startsWith('Vec<') && !this.isHandleArray(decl.id.name) ? `: ${inferredType}` : ''}${initVal};`;
    });
    return decls.join('\n');
  }

  emitIfStatement(node) {
    const condition = this.emit(node.test);
    const consequent = this.emit(node.consequent);

    let result = `${this.indent()}if ${condition} ${consequent}`;
    if (node.alternate) {
      if (node.alternate.type === 'IfStatement') {
        const elseIfStr = this.emit(node.alternate).trimStart();
        result += ` else ${elseIfStr}`;
      } else {
        const alternateStr = this.emit(node.alternate);
        result += ` else ${alternateStr}`;
      }
    }
    return result;
  }

  emitSwitchStatement(node) {
    const simple = this.inferExpressionType(node.discriminant) !== 'String'
      && node.cases.every((cs, i) => (!cs.test ? i === node.cases.length - 1 : ['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'MemberExpression'].includes(cs.test.type))
        && ['BreakStatement', 'ReturnStatement'].includes(cs.consequent.at(-1)?.type)
        && !cs.consequent.slice(0, -1).some(s => JSON.stringify(s).includes('"type":"BreakStatement"')));
    if (!simple) {
      const id = this.switchCounter++;
      const label = `__js2rust_switch_${id}`;
      const value = `__js2rust_value_${id}`;
      const selected = `__js2rust_case_${id}`;
      const defaultIndex = node.cases.findIndex(cs => !cs.test);
      let out = `${this.indent()}'${label}: {\n`;
      this.withIndent(() => {
        out += `${this.indent()}let ${value} = ${this.emit(node.discriminant)};\n`;
        out += `${this.indent()}let ${selected} = match &${value} {\n`;
        this.withIndent(() => {
          node.cases.forEach((cs, i) => {
            if (cs.test) out += `${this.indent()}__v if *__v == ${this.emit(cs.test)} => ${i}usize,\n`;
          });
          out += `${this.indent()}_ => ${defaultIndex < 0 ? node.cases.length : defaultIndex}usize,\n`;
        });
        out += `${this.indent()}};\n`;
        this.breakTargets.push(label);
        try {
          node.cases.forEach((cs, i) => {
            out += `${this.indent()}if ${selected} <= ${i} {\n`;
            this.withIndent(() => { out += cs.consequent.map(s => this.emit(s)).join('\n') + '\n'; });
            out += `${this.indent()}}\n`;
          });
        } finally { this.breakTargets.pop(); }
      });
      return out + `${this.indent()}}`;
    }
    const discriminant = this.emit(node.discriminant);
    let output = `${this.indent()}match ${discriminant} {\n`;

    this.withIndent(() => {
      for (const cs of node.cases) {
        const pattern = cs.test ? this.emit(cs.test) : '_';
        const filteredStmts = cs.consequent.filter((s) => s.type !== 'BreakStatement');
        
        output += `${this.indent()}${pattern} => {\n`;
        this.withIndent(() => {
          for (const s of filteredStmts) {
            output += `${this.emit(s)}\n`;
          }
        });
        output += `${this.indent()}},\n`;
      }
      if (!node.cases.some(cs => !cs.test)) output += `${this.indent()}_ => {},\n`;
    });

    output += `${this.indent()}}`;
    return output;
  }

  emitWhileStatement(node) {
    const test = this.emit(node.test);
    this.forUpdates.push(null);
    this.breakTargets.push(null);
    let body;
    try { body = this.emit(node.body); } finally { this.forUpdates.pop(); this.breakTargets.pop(); }
    return `${this.indent()}while ${test} ${body}`;
  }

  emitForStatement(node) {
    const isStandardRange =
      node.init &&
      node.init.type === 'VariableDeclaration' &&
      node.init.declarations.length === 1 &&
      node.test &&
      node.test.type === 'BinaryExpression' &&
      (node.test.operator === '<' || node.test.operator === '<=') &&
      node.update &&
      (node.update.type === 'UpdateExpression' && node.update.operator === '++') &&
      node.test.left.type === 'Identifier' && node.test.left.name === node.init.declarations[0].id.name &&
      node.update.argument.name === node.init.declarations[0].id.name &&
      node.test.right.type === 'NumericLiteral' &&
      !writesIdentifier(node.body, node.init.declarations[0].id.name);

    if (isStandardRange) {
      const varName = node.init.declarations[0].id.name;
      const start = this.emit(node.init.declarations[0].init);
      const isInclusive = node.test.operator === '<=';
      const end = this.emit(node.test.right);
      const rangeOp = isInclusive ? '..=' : '..';

      this.forUpdates.push(null);
      this.breakTargets.push(null);
      let body;
      try { body = this.emit(node.body); } finally { this.forUpdates.pop(); this.breakTargets.pop(); }
      return `${this.indent()}for ${varName} in ${start}${rangeOp}${end} ${body}`;
    }

    const init = node.init ? `${this.emit(node.init)}\n` : '';
    const test = node.test ? this.emit(node.test) : 'true';
    const updateCode = node.update ? this.emit(node.update) : null;
    const update = updateCode ? `\n${this.withIndent(() => this.indent() + updateCode + ';')}` : '';

    this.forUpdates.push(updateCode);
    this.breakTargets.push(null);
    let bodyContent;
    try {
      bodyContent = node.body.body
        ? node.body.body.map((s) => this.withIndent(() => this.emit(s))).join('\n')
        : this.emit(node.body);
    } finally { this.forUpdates.pop(); this.breakTargets.pop(); }

    return `${init}${this.indent()}while ${test} {\n${bodyContent}${update}\n${this.indent()}}`;
  }

  emitForOfStatement(node) {
    const item = node.left.declarations ? node.left.declarations[0].id.name : node.left.name;
    const list = this.emit(node.right);
    this.forUpdates.push(null);
    this.breakTargets.push(null);
    let body;
    try {
      body = this.withScope([[item, this.elementType(this.inferExpressionType(node.right))]], () => this.emit(node.body));
    } finally { this.forUpdates.pop(); this.breakTargets.pop(); }
    // JoinHandle is intentionally consumed; ordinary arrays preserve their contents.
    const iterator = this.isHandleArray(node.right.name) ? list : `${list}.iter().cloned()`;
    return `${this.indent()}for ${this.formatIdentifier(item)} in ${iterator} ${body}`;
  }

  emitBinaryExpression(node) {
    let op = node.operator;
    if (op === '===') op = '==';
    if (op === '!==') op = '!=';

    if (['in', 'instanceof', '>>>', '??'].includes(op)) this.fail(node, `Unsupported binary operator: ${op}`);
    if (node.type === 'LogicalExpression' && [node.left, node.right].some(n => this.inferExpressionType(n) !== 'bool')) {
      this.fail(node, 'Logical operators currently require boolean operands');
    }
    const leftType = this.inferExpressionType(node.left), rightType = this.inferExpressionType(node.right);
    if (op === '+' && (this.isString(leftType) || this.isString(rightType))) {
      return `format!("{}{}", ${this.emit(node.left)}, ${this.emit(node.right)})`;
    }
    if (op === '**') return `((${this.emit(node.left)}) as f64).powf((${this.emit(node.right)}) as f64)`;
    const float = op === '/' || this.isFloat(leftType) || this.isFloat(rightType);
    const left = float ? this.emitExpected(node.left, 'f64') : this.emit(node.left);
    const right = float ? this.emitExpected(node.right, 'f64') : this.emit(node.right);
    return `(${left} ${op} ${right})`;
  }

  emitUpdateExpression(node) {
    const arg = this.emit(node.argument);
    if (node.operator === '++') return `${arg} += 1`;
    if (node.operator === '--') return `${arg} -= 1`;
    return `${arg} ${node.operator}`;
  }

  emitCallExpression(node) {
    // 1. console.log(...) -> println!(...)
    if (
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'console' &&
      node.callee.property.name === 'log'
    ) {
      if (node.arguments.length === 0) return 'println!()';
      const placeholders = node.arguments.map(a => {
        const t = this.inferExpressionType(a);
        return t && !this.elementType(t) && (!this.structs.has(t) || t.startsWith('Option<')) ? '{}' : '{:?}';
      }).join(' ');
      const args = node.arguments.map((a) => {
        const code = this.emit(a), t = this.inferExpressionType(a);
        return t?.startsWith('Option<') ? `match &(${code}) { Some(v) => format!("{}", v), None => "undefined".to_string() }` : code;
      }).join(', ');
      return `println!("${placeholders}", ${args})`;
    }

    // Unsafe block: unsafe(() => { ... })
    if (node.callee.type === 'Identifier' && node.callee.name === 'unsafe') {
      const fnArg = node.arguments[0];
      if (fnArg && (fnArg.type === 'ArrowFunctionExpression' || fnArg.type === 'FunctionExpression')) {
        return `unsafe ${this.emit(fnArg.body)}`;
      }
    }

    // 2. Math.* built-ins
    if (
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'Math'
    ) {
      const method = node.callee.property.name;
      const args = node.arguments.map((a) => this.emit(a));
      if (method === 'floor') return `(((${args[0]}) as f64).floor() as i64)`;
      if (method === 'sqrt') return `((${args[0]}) as f64).sqrt()`;
      if (method === 'abs') return `((${args[0]})).abs()`;
      if (method === 'pow') return `((${args[0]}) as f64).powf((${args[1]}) as f64)`;
      if (method === 'max' || method === 'min') {
        if (node.arguments.some(a => this.isFloat(this.inferExpressionType(a)))) return `((${args[0]}) as f64).${method}((${args[1]}) as f64)`;
        return `std::cmp::${method}(${args[0]}, ${args[1]})`;
      }
    }

    // 3. Array & Concurrency methods: .push(), .pop(), .includes(), .send(), .recv(), .join(), .lock()
    if (node.callee.type === 'MemberExpression') {
      const obj = this.emit(node.callee.object);
      const method = node.callee.property.name;

      const objectType = this.inferExpressionType(node.callee.object);
      const element = this.elementType(objectType) || this.defaultNumberType;
      const f64 = n => n ? this.emitExpected(n, 'f64') : '0.0';
      const optionNumber = n => n ? `Some(${f64(n)})` : 'None';
      const isText = this.isString(objectType);

      if (method === 'split') {
        if (!isText) this.fail(node, 'split requires a string receiver');
        const omitted = n => !n || (n.type === 'Identifier' && n.name === 'undefined');
        if (!omitted(node.arguments[0]) && !this.isString(this.inferExpressionType(node.arguments[0]))) this.fail(node, 'split supports string separators, not regular expressions');
        const separator = omitted(node.arguments[0]) ? 'None' : `Some(&(${this.emit(node.arguments[0])}))`;
        return `${this.helper('split')}(&(${obj}), ${separator}, ${omitted(node.arguments[1]) ? 'None' : optionNumber(node.arguments[1])})`;
      }
      if (['trim', 'toLowerCase', 'toUpperCase', 'startsWith', 'endsWith'].includes(method) && isText) {
        const methods = { trim: 'trim', toLowerCase: 'to_lowercase', toUpperCase: 'to_uppercase', startsWith: 'starts_with', endsWith: 'ends_with' };
        const args = node.arguments.map(a => `&(${this.emit(a)})`).join(', ');
        return `(${obj}).${methods[method]}(${args})${method === 'trim' ? '.to_string()' : ''}`;
      }
      if (method === 'push') {
        const items = node.arguments.map(a => this.emitExpected(a, element)).join(', ');
        const borrow = objectType?.startsWith('&mut') ? `&mut *${obj}` : `&mut ${obj}`;
        return `{ let __items = vec![${items}]; let __values = ${borrow}; __values.extend(__items); __values.len() as i64 }`;
      }
      if (method === 'pop') return `${obj}.pop()`;
      if (method === 'slice') {
        if (isText) this.fail(node, 'String.slice is not supported; array slice requires an array');
        return `${this.helper('slice')}(&${obj}, ${f64(node.arguments[0])}, ${optionNumber(node.arguments[1])})`;
      }
      if (method === 'splice') {
        const args = node.arguments;
        const items = `vec![${args.slice(2).map(a => this.emitExpected(a, element)).join(', ')}]`;
        // Arguments are evaluated before taking the mutable borrow (e.g. a.splice(0, a.length)).
        const start = f64(args[0]);
        const count = args.length === 0 ? 'Some(0.0)' : optionNumber(args[1]);
        const borrow = objectType?.startsWith('&mut') ? `&mut *${obj}` : `&mut ${obj}`;
        return `{ let __start = ${start}; let __count = ${count}; let __items = ${items}; ${this.helper('splice')}(${borrow}, __start, __count, __items) }`;
      }
      if (method === 'includes' || method === 'indexOf') {
        if (isText) {
          if (node.arguments.length > 1) this.fail(node, 'String includes/indexOf with a start offset is not supported');
          if (method === 'indexOf') this.fail(node, 'String.indexOf is not supported yet');
          return `(${obj}).contains(&(${this.emit(node.arguments[0])}))`;
        }
        return `${this.helper(method === 'includes' ? 'includes' : 'index_of')}(&${obj}, &${this.emitExpected(node.arguments[0], element)}, ${f64(node.arguments[1])})`;
      }
      if (method === 'join' && this.elementType(objectType)) {
        const separator = node.arguments[0] ? this.emit(node.arguments[0]) : '","';
        return `${this.helper('join')}(&${obj}, &(${separator}))`;
      }
      if (['map', 'filter', 'forEach', 'some', 'every', 'find', 'reduce'].includes(method)) {
        const callback = node.arguments[0];
        if (node.callee.object.type === 'Identifier' && writesIdentifier(callback?.body, node.callee.object.name)) {
          this.fail(callback, 'Mutating the source array inside its callback is unsupported');
        }
        const reduce = method === 'reduce';
        const indexed = (callback?.params?.length || 0) > (reduce ? 2 : 1);
        const accumulator = reduce ? this.inferExpressionType(node) : null;
        const fnArg = this.emitArrayCallback(callback, reduce ? [accumulator, element, 'i64'] : [element, 'i64'], {
          indexed, reduce, reference: ['filter', 'find'].includes(method)
        });
        const iterator = `${obj}.iter().cloned()${indexed ? '.enumerate()' : ''}`;
        if (method === 'reduce') {
          if (node.arguments.length > 1) return `${iterator}.fold(${this.emitExpected(node.arguments[1], this.isString(accumulator) ? 'String' : accumulator)}, ${fnArg})`;
          const first = indexed ? '__iter.next().map(|(_, value)| value)' : '__iter.next()';
          const promote = this.isFloat(accumulator) && !this.isFloat(element) ? ' as f64' : '';
          return `{ let mut __iter = ${iterator}; let __first = ${first}.expect("js2rust: reduce of empty array with no initial value")${promote}; __iter.fold(__first, ${fnArg}) }`;
        }
        const rustMethods = { map: 'map', filter: 'filter', forEach: 'for_each', some: 'any', every: 'all', find: 'find' };
        let result = method === 'forEach'
          ? `${iterator}.for_each(|__item| { let _ = (${fnArg})(__item); })`
          : `${iterator}.${rustMethods[method]}(${fnArg})`;
        if (indexed && method === 'filter') result += '.map(|(_, value)| value)';
        if (indexed && method === 'find') result += '.map(|(_, value)| value)';
        if (method === 'map' || method === 'filter') result += '.collect::<Vec<_>>()';
        return result;
      }
      if (this.elementType(objectType) && ['sort', 'reverse', 'concat', 'flat', 'flatMap'].includes(method)) {
        this.fail(node, `Unsupported array method: ${method}`);
      }
      if (method === 'send') {
        const val = this.emit(node.arguments[0]);
        return `${obj}.send(${val}).unwrap()`;
      }
      if (method === 'recv') {
        return `${obj}.recv().unwrap()`;
      }
      if (method === 'join') {
        return `${obj}.join().unwrap()`;
      }
      if (method === 'lock') {
        return `${obj}.lock().unwrap()`;
      }
    }

    // 4. Concurrency: thread.spawn / Thread.spawn / thread.sleep
    if (
      node.callee.type === 'MemberExpression' &&
      (node.callee.object.name === 'thread' || node.callee.object.name === 'Thread')
    ) {
      const method = node.callee.property.name;
      if (method === 'spawn') {
        this.needThread = true;
        const fnArg = this.emit(node.arguments[0]);
        return `thread::spawn(${fnArg})`;
      }
      if (method === 'sleep') {
        this.needThread = true;
        this.needDuration = true;
        const ms = this.emit(node.arguments[0]);
        return `thread::sleep(Duration::from_millis(${ms}))`;
      }
    }

    // 5. Concurrency: mpsc.channel() / createChannel() / channel()
    if (
      (node.callee.type === 'MemberExpression' && node.callee.object.name === 'mpsc' && node.callee.property.name === 'channel') ||
      (node.callee.type === 'Identifier' && (node.callee.name === 'createChannel' || node.callee.name === 'channel'))
    ) {
      this.needMpsc = true;
      return `mpsc::channel()`;
    }

    // 6. Concurrency: Arc.new / Arc.clone / Mutex.new
    if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Arc') {
      this.needArcMutex = true;
      const method = node.callee.property.name;
      if (method === 'new') {
        return `Arc::new(${this.emit(node.arguments[0])})`;
      }
      if (method === 'clone') {
        return `Arc::clone(&${this.emit(node.arguments[0])})`;
      }
    }
    if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Mutex') {
      this.needArcMutex = true;
      if (node.callee.property.name === 'new') {
        return `Mutex::new(${this.emit(node.arguments[0])})`;
      }
    }

    // 4. User function call with Auto-Borrowing & Mut-Borrowing
    const callee = this.emit(node.callee);
    const fnName = node.callee.name;
    const expectedParamInfos = this.signatures.get(fnName);

    const supplied = [...node.arguments];
    if (expectedParamInfos) {
      for (let i = supplied.length; i < expectedParamInfos.length; i++) {
        const fallback = expectedParamInfos[i].defaultValue;
        if (!fallback) this.fail(node, `Missing required argument ${expectedParamInfos[i].name} for ${fnName}`);
        if (!['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'ArrayExpression'].includes(fallback.type)) this.fail(fallback, 'Only literal default parameters are currently supported');
        supplied.push(fallback);
      }
    }
    const args = supplied.map((arg, idx) => {
      const target = expectedParamInfos?.[idx];
      let code = this.emitExpected(arg, target?.type);
      if (expectedParamInfos && expectedParamInfos[idx]) {
        const target = expectedParamInfos[idx];
        if (target.isMut && target.type.startsWith('&mut')) {
          if (!code.startsWith('&mut ')) {
            code = `&mut ${code}`;
          }
        } else if (target.isStruct || target.type.startsWith('&[')) {
          if (!code.startsWith('&')) {
            code = `&${code}`;
          }
        }
      }
      return code;
    }).join(', ');

    return `${callee}(${args})`;
  }

  emitMemberExpression(node) {
    // Enum access: Direction.North -> Direction::North
    if (
      !node.computed &&
      node.object.type === 'Identifier' &&
      ((this.enums && this.enums.has(node.object.name)) ||
       (/^[A-Z]/.test(node.object.name) && /^[A-Z]/.test(node.property.name)))
    ) {
      return `${node.object.name}::${node.property.name}`;
    }

    const obj = this.emit(node.object);

    // Array / String .length -> (obj.len() as i64)
    if (!node.computed && node.property.name === 'length') {
      if (this.isString(this.inferExpressionType(node.object))) return `(${obj}.encode_utf16().count() as i64)`;
      return `(${obj}.len() as i64)`;
    }

    // Smart pointer / Mutex dereferencing: .val / .value -> *obj
    if (!node.computed && (node.property.name === 'val' || node.property.name === 'value')) {
      return `*${obj}`;
    }

    // Index access: arr[i] -> arr[i as usize]
    if (node.computed) {
      const index = this.emit(node.property);
      return `${obj}[(${index}) as usize]`;
    }

    return `${obj}.${this.emit(node.property)}`;
  }

  emitObjectExpression(node) {
    // Guess struct name if available
    for (const [name, props] of this.structs.entries()) {
      const propMap = new Map(props.map((p) => [p.name, p.type]));
      const objKeys = node.properties.map((p) => p.key.name || p.key.value);
      if (objKeys.length === props.length && objKeys.every((k) => propMap.has(k))) {
        const fields = node.properties.map((p) => {
          const key = p.key.name || p.key.value;
          let val = this.emit(p.value);
          const expectedType = propMap.get(key);
          if ((expectedType === 'f64' || expectedType === 'f32') && !val.includes('.') && /^\d+$/.test(val)) {
            val = `${val}.0`;
          }
          return `${key}: ${val}`;
        }).join(', ');
        return `${name} { ${fields} }`;
      }
    }

    const fields = node.properties.map((p) => {
      const key = p.key.name || p.key.value;
      const val = this.emit(p.value);
      return `${key}: ${val}`;
    }).join(', ');

    return `{ ${fields} }`;
  }

  emitTemplateLiteral(node) {
    let formatStr = '';
    const expressions = node.expressions.map((e) => this.emit(e));

    for (let i = 0; i < node.quasis.length; i++) {
      formatStr += (node.quasis[i].value.cooked ?? node.quasis[i].value.raw).replaceAll('{', '{{').replaceAll('}', '}}');
      if (i < expressions.length) {
        formatStr += '{}';
      }
    }

    if (expressions.length === 0) {
      return `${this.rustString(node.quasis[0].value.cooked ?? node.quasis[0].value.raw)}.to_string()`;
    }

    return `format!(${this.rustString(formatStr)}, ${expressions.join(', ')})`;
  }
}
