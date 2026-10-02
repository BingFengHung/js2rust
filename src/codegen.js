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
      // Unwrap ExportNamedDeclaration if present
      if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
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
        return node.name;

      default:
        console.warn(`[js-to-rust] Unsupported AST node: ${node.type}`);
        return `/* Unsupported: ${node.type} */`;
    }
  }

  emitImportDeclaration(node) {
    const rawPath = node.source.value;
    const modName = rawPath.replace(/^\.\//, '').replace(/\.(js|ts|mjs)$/, '');

    const lines = [];
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        lines.push(`use ${modName}::${spec.local.name};`);
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        lines.push(`use ${modName}::*;`);
      } else if (spec.type === 'ImportDefaultSpecifier') {
        lines.push(`use ${modName}::${spec.local.name};`);
      }
    }
    return lines.join('\n');
  }

  emitProgram(node) {
    this.collectSignatures(node, this.rootAst);

    let output = '';

    // 1. Emit generated Rust Structs from JSDoc @typedef
    for (const [name, props] of this.structs.entries()) {
      output += `#[derive(Debug, Clone)]\npub struct ${name} {\n`;
      for (const p of props) {
        output += `    pub ${p.name}: ${p.type},\n`;
      }
      output += `}\n\n`;
    }

    // 2. Emit functions and other statements
    output += node.body.map((stmt) => this.emit(stmt)).join('\n\n') + '\n';
    return output;
  }

  emitFunctionDeclaration(node) {
    const fnName = node.id.name;
    const jsdoc = parseJSDoc(node.leadingComments);
    const isMain = fnName === 'main';

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

    // 3. Array methods: .push(), .pop(), .includes()
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
    const obj = this.emit(node.object);

    // Array / String .length -> (obj.len() as i64)
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
