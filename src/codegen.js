/**
 * Code Generator: Converts AST nodes to formatted Rust source code.
 */

import { parseJSDoc, mapToRustType } from './types.js';

export class RustEmitter {
  constructor(options = {}) {
    this.indentSize = options.indentSize || 4;
    this.indentLevel = 0;
    this.defaultNumberType = options.defaultNumberType || 'i64';
    this.signatures = new Map(); // function name -> Array of param types
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
   * Pre-scan to collect function signatures for auto-borrowing and type resolution
   */
  collectSignatures(node) {
    if (!node || !node.body) return;
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration') {
        const fnName = stmt.id.name;
        const jsdoc = parseJSDoc(stmt.leadingComments);
        const paramTypes = stmt.params.map((param) => {
          const jsType = jsdoc.params[param.name] || this.defaultNumberType;
          return mapToRustType(jsType);
        });
        this.signatures.set(fnName, paramTypes);
      }
    }
  }

  emit(node) {
    if (!node) return '';

    switch (node.type) {
      case 'Program':
        return this.emitProgram(node);

      case 'FunctionDeclaration':
        return this.emitFunctionDeclaration(node);

      case 'BlockStatement':
        return this.emitBlockStatement(node);

      case 'VariableDeclaration':
        return this.emitVariableDeclaration(node);

      case 'IfStatement':
        return this.emitIfStatement(node);

      case 'WhileStatement':
        return this.emitWhileStatement(node);

      case 'ForStatement':
        return this.emitForStatement(node);

      case 'ForOfStatement':
        return this.emitForOfStatement(node);

      case 'ReturnStatement':
        return `${this.indent()}return ${this.emit(node.argument)};`;

      case 'ExpressionStatement':
        return `${this.indent()}${this.emit(node.expression)};`;

      case 'BinaryExpression':
        return this.emitBinaryExpression(node);

      case 'UnaryExpression':
        return `${node.operator}${this.emit(node.argument)}`;

      case 'UpdateExpression':
        return this.emitUpdateExpression(node);

      case 'AssignmentExpression':
        return `${this.emit(node.left)} ${node.operator} ${this.emit(node.right)}`;

      case 'CallExpression':
        return this.emitCallExpression(node);

      case 'MemberExpression':
        return this.emitMemberExpression(node);

      case 'ArrayExpression':
        return `vec![${node.elements.map((e) => this.emit(e)).join(', ')}]`;

      case 'NumericLiteral':
        return String(node.value);

      case 'StringLiteral':
        return `"${node.value}"`;

      case 'BooleanLiteral':
        return node.value ? 'true' : 'false';

      case 'Identifier':
        return node.name;

      default:
        console.warn(`[js-to-rust] Unsupported AST node: ${node.type}`);
        return `/* Unsupported: ${node.type} */`;
    }
  }

  emitProgram(node) {
    this.collectSignatures(node);
    return node.body.map((stmt) => this.emit(stmt)).join('\n\n') + '\n';
  }

  emitFunctionDeclaration(node) {
    const fnName = node.id.name;
    const jsdoc = parseJSDoc(node.leadingComments);

    const isMain = fnName === 'main';

    // Parse parameters
    const params = node.params.map((param) => {
      const name = param.name;
      const jsType = jsdoc.params[name] || this.defaultNumberType;
      const rustType = mapToRustType(jsType);
      return `${name}: ${rustType}`;
    }).join(', ');

    // Parse return type
    let returnClause = '';
    if (!isMain && jsdoc.returns && jsdoc.returns !== 'void') {
      const rustRet = mapToRustType(jsdoc.returns, true);
      returnClause = ` -> ${rustRet}`;
    } else if (!isMain && !jsdoc.returns && this.hasReturnWithVal(node.body)) {
      returnClause = ` -> ${this.defaultNumberType}`;
    }

    const visibility = isMain ? '' : 'pub ';
    const header = `${this.indent()}${visibility}fn ${fnName}(${params})${returnClause} `;
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
      const varName = decl.id.name;
      const mutPrefix = isConst ? 'let ' : 'let mut ';
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

  emitWhileStatement(node) {
    const test = this.emit(node.test);
    const body = this.emit(node.body);
    return `${this.indent()}while ${test} ${body}`;
  }

  emitForStatement(node) {
    // Check if it matches: for (let i = start; i < end; i++) or <=
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

    // Fallback: transpile to standard loop or while
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
    return `${this.indent()}for &${item} in ${list}.iter() ${body}`;
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
    // Check for console.log
    if (
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'console' &&
      node.callee.property.name === 'log'
    ) {
      if (node.arguments.length === 1) {
        return `println!("{:?}", ${this.emit(node.arguments[0])})`;
      }
      const placeholders = node.arguments.map(() => '{}').join(' ');
      const args = node.arguments.map((a) => this.emit(a)).join(', ');
      return `println!("${placeholders}", ${args})`;
    }

    // Check for Math.* built-ins
    if (
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'Math'
    ) {
      const method = node.callee.property.name;
      const args = node.arguments.map((a) => this.emit(a));
      if (method === 'floor') return `(${args[0]} as i64)`;
      if (method === 'sqrt') return `(${args[0]} as f64).sqrt()`;
      if (method === 'abs') return `(${args[0]}).abs()`;
      if (method === 'pow') return `(${args[0]} as f64).powf(${args[1]} as f64)`;
      if (method === 'max') return `std::cmp::max(${args[0]}, ${args[1]})`;
      if (method === 'min') return `std::cmp::min(${args[0]}, ${args[1]})`;
    }

    const callee = this.emit(node.callee);
    const fnName = node.callee.name;
    const expectedParamTypes = this.signatures.get(fnName);

    const args = node.arguments.map((arg, idx) => {
      let code = this.emit(arg);
      // Auto-borrow slices if target expects &[T]
      if (expectedParamTypes && expectedParamTypes[idx]?.startsWith('&[')) {
        if (!code.startsWith('&')) {
          code = `&${code}`;
        }
      }
      return code;
    }).join(', ');

    return `${callee}(${args})`;
  }

  emitMemberExpression(node) {
    const obj = this.emit(node.object);

    // Array / String .length -> .len()
    if (!node.computed && node.property.name === 'length') {
      return `(${obj}.len() as i64)`;
    }

    // Index access: arr[i] -> arr[i as usize]
    if (node.computed) {
      const index = this.emit(node.property);
      return `${obj}[${index} as usize]`;
    }

    return `${obj}.${this.emit(node.property)}`;
  }
}
