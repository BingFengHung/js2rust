/**
 * Advanced Code Generator: Converts AST nodes to formatted, idiomatic Rust.
 */

import { parseJSDoc, mapToRustType } from './types.js';
import { inferParameterType } from './inference.js';

export class RustEmitter {
  constructor(options = {}) {
    this.indentSize = options.indentSize || 4;
    this.indentLevel = 0;
    this.defaultNumberType = options.defaultNumberType || 'i64';
    this.signatures = new Map(); // fnName -> Array<{ name: string, type: string, isMut: boolean, isStruct: boolean }>
    this.structs = new Map();    // structName -> Array<{ name: string, type: string }>
    this.rootAst = null;
    this.needThread = false;
    this.needDuration = false;
    this.needMpsc = false;
    this.needArcMutex = false;
    this.classes = new Set();
    this.classMutatingMethods = new Set();
    this.mutatedVars = new Set();
    this.enums = new Set();
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

  collectClasses(programNode) {
    if (!programNode || !programNode.body) return;
    this.classes = new Set();
    this.classMutatingMethods = new Set();

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
        const fnName = stmt.id.name;
        const jsdoc = parseJSDoc(stmt.leadingComments);
        const mutatedParams = this.findMutatedParams(stmt);

        const paramInfos = stmt.params.map((param, paramIdx) => {
          const name = param.type === 'AssignmentPattern' ? param.left.name : param.name;
          const isMut = mutatedParams.has(name);

          // 1. Try JSDoc first
          let rawType = jsdoc.params[name];

          // 2. If no JSDoc, run Smart Type Inference!
          if (!rawType) {
            rawType = inferParameterType(fnName, paramIdx, name, param, stmt, ast);
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

          return { name, type: rustType, isMut, isStruct };
        });

        this.signatures.set(fnName, paramInfos);
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
        return `${this.indent()}break;`;

      case 'ContinueStatement':
        return `${this.indent()}continue;`;

      case 'ReturnStatement':
        return `${this.indent()}return ${this.emit(node.argument)};`;

      case 'ExpressionStatement':
        return `${this.indent()}${this.emit(node.expression)};`;

      case 'BinaryExpression':
      case 'LogicalExpression':
        return this.emitBinaryExpression(node);

      case 'UnaryExpression':
        return `${node.operator}${this.emit(node.argument)}`;

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
        return `vec![${node.elements.map((e) => this.emit(e)).join(', ')}]`;

      case 'ObjectExpression':
        return this.emitObjectExpression(node);

      case 'TemplateLiteral':
        return this.emitTemplateLiteral(node);

      case 'NumericLiteral':
        return String(node.value);

      case 'StringLiteral':
        return `"${node.value}"`;

      case 'BooleanLiteral':
        return node.value ? 'true' : 'false';

      case 'Identifier':
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

      default:
        console.warn(`[js-to-rust] Unsupported AST node: ${node.type}`);
        return `/* Unsupported: ${node.type} */`;
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
    const ctorParams = ctor ? ctor.params : [];
    const ctorJsdoc = ctor ? parseJSDoc(ctor.leadingComments) : { params: {}, returns: null };

    // Explicit class properties (e.g. class Foo { count = 0; })
    for (const member of node.body.body) {
      if (member.type === 'ClassProperty' || member.type === 'PropertyDefinition') {
        const propName = member.key.name;
        let propType = this.defaultNumberType;
        if (member.value) {
          if (member.value.type === 'NumericLiteral') {
            propType = Number.isInteger(member.value.value) ? this.defaultNumberType : 'f64';
          } else if (member.value.type === 'StringLiteral') {
            propType = 'String';
          } else if (member.value.type === 'BooleanLiteral') {
            propType = 'bool';
          }
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
          let fieldType = this.defaultNumberType;

          if (stmt.expression.right.type === 'Identifier') {
            const paramName = stmt.expression.right.name;
            if (ctorJsdoc.params[paramName]) {
              fieldType = mapToRustType(ctorJsdoc.params[paramName]);
            } else if (
              paramName.toLowerCase().includes('name') ||
              paramName.toLowerCase().includes('title') ||
              paramName.toLowerCase().includes('str') ||
              paramName.toLowerCase().includes('owner') ||
              paramName.toLowerCase().includes('msg')
            ) {
              fieldType = 'String';
            } else {
              fieldType = this.defaultNumberType;
            }
          } else if (stmt.expression.right.type === 'StringLiteral') {
            fieldType = 'String';
          } else if (stmt.expression.right.type === 'BooleanLiteral') {
            fieldType = 'bool';
          } else if (stmt.expression.right.type === 'NumericLiteral') {
            fieldType = Number.isInteger(stmt.expression.right.value) ? this.defaultNumberType : 'f64';
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
          let pType = ctorJsdoc.params[pName] ? mapToRustType(ctorJsdoc.params[pName]) : (fields.get(pName) || this.defaultNumberType);
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
              } else {
                const defaultVal = type === 'String' ? 'String::new()' : (type === 'bool' ? 'false' : '0');
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
              const defaultVal = type === 'String' ? 'String::new()' : (type === 'bool' ? 'false' : '0');
              implCode += `${this.indent()}${name}: ${defaultVal},\n`;
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
          const pType = methodJsdoc.params[pName] ? mapToRustType(methodJsdoc.params[pName]) : this.defaultNumberType;
          return `${pName}: ${pType}`;
        });

        const allParams = [selfParam, ...methodParams].join(', ');

        let returnClause = '';
        if (methodJsdoc.returns && methodJsdoc.returns !== 'void') {
          returnClause = ` -> ${mapToRustType(methodJsdoc.returns, true)}`;
        } else if (this.hasReturnWithVal(method.body)) {
          returnClause = ` -> ${this.defaultNumberType}`;
        }

        implCode += `${this.indent()}pub fn ${rustMethodName}(${allParams})${returnClause} `;
        const bodyStr = this.emit(method.body);
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
            const pType = methodJsdoc.params[pName] ? mapToRustType(methodJsdoc.params[pName]) : this.defaultNumberType;
            return `${pName}: ${pType}`;
          });
          const allParams = [selfParam, ...methodParams].join(', ');

          let returnClause = '';
          if (methodJsdoc.returns && methodJsdoc.returns !== 'void') {
            returnClause = ` -> ${mapToRustType(methodJsdoc.returns, true)}`;
          } else if (this.hasReturnWithVal(method.body)) {
            returnClause = ` -> String`;
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

  emitImportDeclaration(node) {
    const rawPath = node.source.value;
    const cleanPath = rawPath
      .replace(/^\.\//, '')
      .replace(/^src\//, '')
      .replace(/\.(js|ts|mjs)$/, '')
      .split('/')
      .map((s) => s.replace(/[^a-zA-Z0-9_]/g, '_'))
      .join('::');

    const lines = [];
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        lines.push(`use ${cleanPath}::${spec.local.name};`);
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        lines.push(`use ${cleanPath}::*;`);
      } else if (spec.type === 'ImportDefaultSpecifier') {
        lines.push(`use ${cleanPath}::${spec.local.name};`);
      }
    }
    return lines.join('\n');
  }

  emitProgram(node) {
    this.collectClasses(node);
    this.collectMutatedVars(node);
    this.collectSignatures(node, this.rootAst);

    const bodyOutput = node.body.map((stmt) => this.emit(stmt)).join('\n\n') + '\n';

    let output = '';

    // Standard Library imports for Concurrency
    if (this.needThread) output += 'use std::thread;\n';
    if (this.needDuration) output += 'use std::time::Duration;\n';
    if (this.needMpsc) output += 'use std::sync::mpsc;\n';
    if (this.needArcMutex) output += 'use std::sync::{Arc, Mutex};\n';
    if (output) output += '\n';

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
    const isAsync = Boolean(node.async);

    const paramInfos = this.signatures.get(fnName) || [];
    const params = paramInfos.map((p) => `${p.name}: ${p.type}`).join(', ');

    // Return type
    let returnClause = '';
    if (!isMain && jsdoc.returns && jsdoc.returns !== 'void') {
      const rustRet = mapToRustType(jsdoc.returns, true);
      returnClause = ` -> ${rustRet}`;
    } else if (!isMain && !jsdoc.returns && this.hasReturnWithVal(node.body)) {
      returnClause = ` -> ${this.defaultNumberType}`;
    }

    let tokioAttribute = '';
    if (isMain && isAsync) {
      tokioAttribute = `#[tokio::main]\n${this.indent()}`;
    }

    const visibility = isMain ? '' : 'pub ';
    const asyncPrefix = isAsync ? 'async ' : '';
    const lifetimeClause = jsdoc.lifetime ? `<${jsdoc.lifetime}>` : '';
    const header = `${this.indent()}${tokioAttribute}${visibility}${asyncPrefix}fn ${fnName}${lifetimeClause}(${params})${returnClause} `;
    const body = this.emit(node.body);

    return header + body;
  }

  hasReturnWithVal(blockNode) {
    if (!blockNode || !blockNode.body) return false;
    return blockNode.body.some(
      (stmt) => stmt.type === 'ReturnStatement' && stmt.argument !== null
    );
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
        varName = decl.id.name;
      }
      let needsMut = !isConst;
      if (isConst && decl.id.name && this.mutatedVars && this.mutatedVars.has(decl.id.name)) {
        needsMut = true;
      }
      const mutPrefix = needsMut ? 'let mut ' : 'let ';
      const initVal = decl.init ? ` = ${this.emit(decl.init)}` : '';
      return `${this.indent()}${mutPrefix}${varName}${initVal};`;
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
    });

    output += `${this.indent()}}`;
    return output;
  }

  emitWhileStatement(node) {
    const test = this.emit(node.test);
    const body = this.emit(node.body);
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
      (node.update.type === 'UpdateExpression' && node.update.operator === '++');

    if (isStandardRange) {
      const varName = node.init.declarations[0].id.name;
      const start = this.emit(node.init.declarations[0].init);
      const isInclusive = node.test.operator === '<=';
      const end = this.emit(node.test.right);
      const rangeOp = isInclusive ? '..=' : '..';

      const body = this.emit(node.body);
      return `${this.indent()}for ${varName} in ${start}${rangeOp}${end} ${body}`;
    }

    const init = node.init ? `${this.emit(node.init)}\n` : '';
    const test = node.test ? this.emit(node.test) : 'true';
    const update = node.update ? `\n${this.withIndent(() => this.indent() + this.emit(node.update) + ';')}` : '';

    const bodyContent = node.body.body
      ? node.body.body.map((s) => this.withIndent(() => this.emit(s))).join('\n')
      : this.emit(node.body);

    return `${init}${this.indent()}while ${test} {\n${bodyContent}${update}\n${this.indent()}}`;
  }

  emitForOfStatement(node) {
    const item = node.left.declarations ? node.left.declarations[0].id.name : node.left.name;
    const list = this.emit(node.right);
    const body = this.emit(node.body);
    return `${this.indent()}for ${item} in ${list} ${body}`;
  }

  emitBinaryExpression(node) {
    let op = node.operator;
    if (op === '===') op = '==';
    if (op === '!==') op = '!=';

    const left = this.emit(node.left);
    const right = this.emit(node.right);
    return `${left} ${op} ${right}`;
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
      if (node.arguments.length === 1) {
        return `println!("{:?}", ${this.emit(node.arguments[0])})`;
      }
      const placeholders = node.arguments.map(() => '{:?}').join(' ');
      const args = node.arguments.map((a) => this.emit(a)).join(', ');
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
      if (method === 'floor') return `((${args[0]}) as i64)`;
      if (method === 'sqrt') return `((${args[0]}) as f64).sqrt()`;
      if (method === 'abs') return `((${args[0]})).abs()`;
      if (method === 'pow') return `((${args[0]}) as f64).powf((${args[1]}) as f64)`;
      if (method === 'max') return `std::cmp::max(${args[0]}, ${args[1]})`;
      if (method === 'min') return `std::cmp::min(${args[0]}, ${args[1]})`;
    }

    // 3. Array & Concurrency methods: .push(), .pop(), .includes(), .send(), .recv(), .join(), .lock()
    if (node.callee.type === 'MemberExpression') {
      const obj = this.emit(node.callee.object);
      const method = node.callee.property.name;

      if (method === 'push') {
        const val = this.emit(node.arguments[0]);
        return `${obj}.push(${val})`;
      }
      if (method === 'pop') {
        return `${obj}.pop()`;
      }
      if (method === 'includes') {
        const val = this.emit(node.arguments[0]);
        return `${obj}.contains(&${val})`;
      }
      if (method === 'map') {
        const fnArg = this.emit(node.arguments[0]);
        return `${obj}.into_iter().map(${fnArg}).collect::<Vec<_>>()`;
      }
      if (method === 'filter') {
        let fnArg = '';
        if (node.arguments[0] && (node.arguments[0].type === 'ArrowFunctionExpression' || node.arguments[0].type === 'FunctionExpression')) {
          fnArg = this.emitClosure(node.arguments[0], true, true);
        } else {
          fnArg = this.emit(node.arguments[0]);
        }
        return `${obj}.into_iter().filter(${fnArg}).collect::<Vec<_>>()`;
      }
      if (method === 'forEach') {
        const fnArg = this.emit(node.arguments[0]);
        return `${obj}.iter().for_each(${fnArg})`;
      }
      if (method === 'reduce') {
        const fnArg = this.emit(node.arguments[0]);
        const initVal = node.arguments[1] ? this.emit(node.arguments[1]) : '0';
        return `${obj}.into_iter().fold(${initVal}, ${fnArg})`;
      }
      if (method === 'some') {
        let fnArg = '';
        if (node.arguments[0] && (node.arguments[0].type === 'ArrowFunctionExpression' || node.arguments[0].type === 'FunctionExpression')) {
          fnArg = this.emitClosure(node.arguments[0], true, true);
        } else {
          fnArg = this.emit(node.arguments[0]);
        }
        return `${obj}.into_iter().any(${fnArg})`;
      }
      if (method === 'every') {
        let fnArg = '';
        if (node.arguments[0] && (node.arguments[0].type === 'ArrowFunctionExpression' || node.arguments[0].type === 'FunctionExpression')) {
          fnArg = this.emitClosure(node.arguments[0], true, true);
        } else {
          fnArg = this.emit(node.arguments[0]);
        }
        return `${obj}.into_iter().all(${fnArg})`;
      }
      if (method === 'find') {
        let fnArg = '';
        if (node.arguments[0] && (node.arguments[0].type === 'ArrowFunctionExpression' || node.arguments[0].type === 'FunctionExpression')) {
          fnArg = this.emitClosure(node.arguments[0], true, true);
        } else {
          fnArg = this.emit(node.arguments[0]);
        }
        return `${obj}.into_iter().find(${fnArg})`;
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

    const args = node.arguments.map((arg, idx) => {
      let code = this.emit(arg);
      if (expectedParamInfos && expectedParamInfos[idx]) {
        const target = expectedParamInfos[idx];
        if (target.isMut) {
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
      this.enums &&
      this.enums.has(node.object.name)
    ) {
      return `${node.object.name}::${node.property.name}`;
    }

    const obj = this.emit(node.object);

    // Array / String .length -> (obj.len() as i64)
    if (!node.computed && node.property.name === 'length') {
      return `(${obj}.len() as i64)`;
    }

    // Smart pointer / Mutex dereferencing: .val / .value -> *obj
    if (!node.computed && (node.property.name === 'val' || node.property.name === 'value')) {
      return `*${obj}`;
    }

    // Index access: arr[i] -> arr[i as usize]
    if (node.computed) {
      const index = this.emit(node.property);
      return `${obj}[${index} as usize]`;
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
      formatStr += node.quasis[i].value.raw;
      if (i < expressions.length) {
        formatStr += '{}';
      }
    }

    if (expressions.length === 0) {
      return `"${formatStr}".to_string()`;
    }

    return `format!("${formatStr}", ${expressions.join(', ')})`;
  }
}
