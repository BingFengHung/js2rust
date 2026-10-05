import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import path from 'node:path';
import { parseJSDoc } from './types.js';
import { RustEmitter } from './codegen.js';

const traverse = traverseModule.default || traverseModule;
const globals = new Set([
  'console',
  'Math',
  'NaN',
  'Infinity',
  'undefined',
  'Promise',
  'setTimeout',
  'thread',
  'Thread',
  'mpsc',
  'Arc',
  'Mutex',
  'unsafe',
  'channel',
  'createChannel',
  'Map',
  'Set',
  'Array',
]);
const unsupportedGlobals = new Set([
  'process',
  'require',
  'fetch',
  'JSON',
  'Date',
  'Object',
  'Number',
  'String',
  'Boolean',
  'window',
  'document',
  'eval',
]);
const callbacks = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'some',
  'every',
  'find',
]);
const arrayMethods = new Set([
  ...callbacks,
  'push',
  'pop',
  'slice',
  'splice',
  'includes',
  'indexOf',
  'join',
  'sort',
  'reverse',
  'flat',
]);
const stringMethods = new Set([
  'split',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'startsWith',
  'endsWith',
  'includes',
]);
const unsupportedNodes = new Set([
  'TryStatement',
  'ThrowStatement',
  'DoWhileStatement',
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',
  'DebuggerStatement',
  'SpreadElement',
  'RestElement',
  'OptionalCallExpression',
  'OptionalMemberExpression',
  'TaggedTemplateExpression',
  'YieldExpression',
]);

export function diagnostic(
  node,
  code,
  message,
  filename = 'source',
  severity = 'error',
  category = 'javascript',
) {
  const loc = node?.loc?.start || { line: 1, column: 0 };
  const end = node?.loc?.end || loc;
  return {
    code,
    severity,
    category,
    message,
    filename,
    line: loc.line,
    column: loc.column + 1,
    endLine: end.line,
    endColumn: end.column + 1,
  };
}

export class JavaScriptValidationError extends Error {
  constructor(diagnostics) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    super(
      errors
        .map(
          (d) =>
            `${d.code}: ${d.message} (${d.filename}:${d.line}:${d.column})${d.hint ? `\n  建議：${d.hint}` : ''}${(d.related || []).map((r) => `\n  來源：${r.filename}:${r.line}:${r.column} ${r.message}`).join('')}`,
        )
        .join('\n'),
    );
    this.name = 'JavaScriptValidationError';
    this.diagnostics = diagnostics;
  }
}

export function parseJavaScript(source, filename = 'source') {
  try {
    return {
      ast: parse(source, {
        sourceType: 'module',
        plugins: ['classProperties', 'numericSeparator', 'typescript'],
      }),
      diagnostics: [],
    };
  } catch (error) {
    return {
      ast: null,
      diagnostics: [
        diagnostic(
          { loc: { start: error.loc, end: error.loc } },
          'JS_SYNTAX',
          `JavaScript 語法錯誤：${error.message}`,
          filename,
        ),
      ],
    };
  }
}

function normalizeType(value) {
  if (!value) return null;
  if (value.includes('|')) {
    const parts = value.split('|').map(v => v.trim());
    const concrete = parts.filter(v => !['null', 'undefined'].includes(v));
    return concrete.length === 1 ? `maybe:${normalizeType(concrete[0])}` : null;
  }
  if (['null', 'undefined'].includes(value)) return value;
  if (value === 'void') return 'void';
  if (
    [
      'number',
      'int',
      'integer',
      'float',
      'f64',
      'f32',
      'i64',
      'i32',
      'usize',
    ].includes(value)
  )
    return 'number';
  if (['string', 'String', '&str'].includes(value)) return 'string';
  if (['bool', 'boolean'].includes(value)) return 'boolean';
  if (value.endsWith('[]'))
    return `array:${normalizeType(value.slice(0, -2)) || '?'}`;
  const array = value.match(/^Array<(.+)>$/);
  return array ? `array:${normalizeType(array[1]) || '?'}` : null;
}
function annotatedType(node) {
  const annotation = node?.typeAnnotation?.typeAnnotation || node;
  if (!annotation) return null;
  if (annotation.type === 'TSUnionType') {
    const concrete = annotation.types.filter(t => !['TSNullKeyword', 'TSUndefinedKeyword'].includes(t.type));
    return concrete.length === 1 ? `maybe:${annotatedType(concrete[0])}` : null;
  }
  if (annotation.type === 'TSTypeReference' && ['Map', 'Set'].includes(annotation.typeName.name)) return `${annotation.typeName.name.toLowerCase()}:${annotation.typeParameters?.params.map(annotatedType).join('|') || '?'}`;
  return (
    {
      TSNumberKeyword: 'number',
      TSStringKeyword: 'string',
      TSBooleanKeyword: 'boolean',
      TSVoidKeyword: 'void',
      TSNullKeyword: 'null',
      TSUndefinedKeyword: 'undefined',
    }[annotation.type] ||
    (annotation.type === 'TSArrayType'
      ? `array:${annotatedType(annotation.elementType) || '?'}`
      : null)
  );
}
function docsFor(fnPath) {
  return parseJSDoc([
    ...(fnPath.node.leadingComments || []),
    ...(fnPath.parentPath?.node.leadingComments || []),
  ]);
}
function compatible(actual, expected) {
  if (!actual || !expected) return true;
  if (actual === expected) return true;
  if (expected.startsWith('maybe:')) return ['null', 'undefined'].includes(actual) || compatible(actual.replace(/^maybe:/, ''), expected.slice(6));
  if (actual.startsWith('maybe:')) return compatible(actual.slice(6), expected);
  if (['null', 'undefined'].includes(actual) || ['null', 'undefined'].includes(expected)) return false;
  return (
    actual.startsWith('array:') &&
    expected.startsWith('array:') &&
    (actual.endsWith(':?') || expected.endsWith(':?'))
  );
}

/** Scope-aware checks only; source is never evaluated or executed. */
export function analyzeJavaScript(source, options = {}) {
  const filename = options.filename || 'source';
  const result = parseJavaScript(source, filename);
  if (!result.ast) return result;
  const diagnostics = [];
  const paths = new WeakMap();
  const nodeFiles = new WeakMap();
  const enums = new Set();
  const namedTypes = new Set();
  const callTypes = new Map();
  const modules = new Map();
  for (const comment of result.ast.comments || []) {
    const name = parseJSDoc([comment]).typedef?.name;
    if (name) namedTypes.add(name);
  }
  traverse(result.ast, {
    enter(p) {
      paths.set(p.node, p);
      nodeFiles.set(p.node, filename);
      if (p.isTSEnumDeclaration()) enums.add(p.node.id.name);
      if (
        [
          'ClassDeclaration',
          'TSEnumDeclaration',
          'TSInterfaceDeclaration',
          'TSTypeAliasDeclaration',
        ].includes(p.node.type) &&
        p.node.id
      )
        namedTypes.add(p.node.id.name);
    },
  });
  const report = (
    node,
    code,
    message,
    severity = 'error',
    category = 'javascript',
    details = {},
  ) =>
    diagnostics.push({
      ...diagnostic(node, code, message, filename, severity, category),
      ...details,
    });
  const bindingFunction = (binding) => {
    if (!binding) return null;
    if (binding.path.isFunctionDeclaration()) return binding.path;
    if (
      binding.path.isVariableDeclarator() &&
      ['ArrowFunctionExpression', 'FunctionExpression'].includes(
        binding.path.node.init?.type,
      )
    )
      return binding.path.get('init');
    if (binding.kind === 'module' && options.files) {
      const declaration = binding.path.parentPath.node;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filename), declaration.source.value),
      );
      const module = moduleRecord(resolved);
      const exported = binding.path.isImportDefaultSpecifier()
        ? 'default'
        : binding.path.node.imported?.name;
      return module?.exports.get(exported)?.isFunction()
        ? module.exports.get(exported)
        : null;
    }
    return null;
  };
  function moduleRecord(resolved) {
    if (modules.has(resolved)) return modules.get(resolved);
    const source = Object.entries(options.files || {}).find(
      ([file]) => path.posix.normalize(file) === resolved,
    )?.[1];
    if (typeof source !== 'string') return null;
    const ast = parseJavaScript(source, resolved).ast;
    if (!ast) return null;
    let program;
    traverse(ast, {
      enter(p) {
        paths.set(p.node, p);
        nodeFiles.set(p.node, resolved);
      },
      Program(p) {
        program = p;
      },
    });
    const exports = new Map();
    for (const statement of program.get('body')) {
      if (statement.isExportDefaultDeclaration())
        exports.set('default', statement.get('declaration'));
      if (statement.isExportNamedDeclaration()) {
        const declaration = statement.get('declaration');
        if (declaration.node?.id)
          exports.set(declaration.node.id.name, declaration);
        for (const spec of statement.node.specifiers) {
          const binding = program.scope.getBinding(spec.local.name);
          if (binding) exports.set(spec.exported.name, binding.path);
        }
      }
    }
    const record = { exports };
    modules.set(resolved, record);
    return record;
  }
  function infer(node, scope, seen = new Set()) {
    if (!node || seen.has(node)) return null;
    const next = new Set(seen).add(node);
    if (node.type === 'NumericLiteral') return 'number';
    if (['StringLiteral', 'TemplateLiteral'].includes(node.type))
      return 'string';
    if (node.type === 'BooleanLiteral') return 'boolean';
    if (node.type === 'NullLiteral') return 'null';
    if (node.type === 'NewExpression' && ['Map', 'Set'].includes(node.callee.name)) {
      if (node.typeParameters) return `${node.callee.name.toLowerCase()}:${node.typeParameters.params.map(annotatedType).join('|')}`;
      const input = node.arguments[0];
      const first = input?.elements?.[0];
      return node.callee.name === 'Map' ? `map:${infer(first?.elements?.[0], scope, next) || '?'}|${infer(first?.elements?.[1], scope, next) || '?'}` : `set:${infer(first, scope, next) || '?'}`;
    }
    if (node.type === 'ArrayExpression') {
      const types = new Set(
        node.elements.map((e) => infer(e, scope, next)).filter(Boolean),
      );
      return `array:${types.size === 1 ? [...types][0] : '?'}`;
    }
    if (node.type === 'Identifier') {
      if (['NaN', 'Infinity'].includes(node.name)) return 'number';
      if (node.name === 'undefined') return 'undefined';
      const binding = scope.getBinding(node.name);
      if (!binding) return null;
      if (binding.kind === 'param') {
        const fn = binding.path.getFunctionParent();
        const explicit =
          annotatedType(binding.path.node) ||
          normalizeType(docsFor(fn).params[node.name]);
        if (explicit) return explicit;
        const call = fn?.parentPath;
        if (
          call?.isCallExpression() &&
          call.node.callee.type === 'MemberExpression'
        ) {
          const method = call.node.callee.property.name;
          const element = infer(
            call.node.callee.object,
            call.scope,
            next,
          )?.replace(/^array:/, '');
          const index = fn.node.params.findIndex((p) => p.name === node.name);
          if (method === 'reduce')
            return index === 2
              ? 'number'
              : index === 0 && call.node.arguments[1]
                ? infer(call.node.arguments[1], call.scope, next)
                : element;
          if (method === 'sort') return element;
          if (callbacks.has(method)) return index === 1 ? 'number' : element;
        }
        const parameter = fn?.node.params.find(
          (p) => (p.left || p).name === node.name,
        );
        return parameter?.type === 'AssignmentPattern'
          ? infer(parameter.right, fn.scope, next)
          : inferParameterFromCalls(fn, node.name, next);
      }
      if (binding.path.isVariableDeclarator()) {
        const declaration = binding.path.node;
        return (
          annotatedType(declaration.id) ||
          infer(declaration.init, binding.path.scope, next)
        );
      }
      return null;
    }
    if (node.type === 'UnaryExpression')
      return node.operator === '!'
        ? 'boolean'
        : infer(node.argument, scope, next);
    if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) {
      if (
        ['==', '===', '!=', '!==', '<', '<=', '>', '>='].includes(node.operator)
      )
        return 'boolean';
      const a = infer(node.left, scope, next),
        b = infer(node.right, scope, next);
      if (node.operator === '+' && (a === 'string' || b === 'string'))
        return 'string';
      if (a === 'number' && b === 'number') return 'number';
      return a === b ? a : null;
    }
    if (node.type === 'ConditionalExpression') {
      const a = infer(node.consequent, scope, next),
        b = infer(node.alternate, scope, next);
      if (['null', 'undefined'].includes(a)) return `maybe:${b}`;
      if (['null', 'undefined'].includes(b)) return `maybe:${a}`;
      return a === b ? a : null;
    }
    if (node.type === 'MemberExpression')
      return ['length', 'size'].includes(node.property.name)
        ? 'number'
        : node.computed
          ? infer(node.object, scope, next)?.replace(/^array:/, '')
          : null;
    if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier') {
        const fn = bindingFunction(scope.getBinding(node.callee.name));
        return fn ? inferReturn(fn, next) : null;
      }
      if (node.callee.type !== 'MemberExpression') return null;
      const method = node.callee.property.name;
      if (node.callee.object.name === 'Math') return 'number';
      if (
        ['includes', 'some', 'every', 'startsWith', 'endsWith'].includes(method)
      )
        return 'boolean';
      if (['push', 'indexOf'].includes(method)) return 'number';
      if (['join', 'trim', 'toLowerCase', 'toUpperCase'].includes(method))
        return 'string';
      if (method === 'split') return 'array:string';
      const receiver = infer(node.callee.object, scope, next);
      if (node.callee.object.name === 'Array' && method === 'from') {
        const input = infer(node.arguments[0], scope, next);
        return input?.startsWith('set:') ? `array:${input.slice(4)}` : input;
      }
      if (receiver?.startsWith('map:') || receiver?.startsWith('set:')) {
        const parts = receiver.slice(4).split('|');
        if (['has', 'delete'].includes(method)) return 'boolean';
        if (method === 'get') return `maybe:${parts[1]}`;
        if (['keys', 'values'].includes(method)) return `array:${method === 'keys' ? parts[0] : parts[1] || parts[0]}`;
        if (['set', 'add'].includes(method)) return receiver;
      }
      if (['pop', 'find'].includes(method)) return `maybe:${receiver?.replace(/^array:/, '') || '?'}`;
      if (['slice', 'splice', 'filter', 'reverse', 'sort'].includes(method)) return receiver;
      if (method === 'flat') return null; // Depth is resolved by the emitter.
      const callback = node.arguments[0];
      if (
        ['map', 'reduce'].includes(method) &&
        callback &&
        callback.body?.type !== 'BlockStatement'
      ) {
        const type = infer(
          callback.body,
          paths.get(callback)?.scope || scope,
          next,
        );
        return method === 'map' ? `array:${type || '?'}` : type;
      }
    }
    return null;
  }
  function inferParameterFromCalls(fn, name, seen) {
    if (!fn?.node.id || seen.has(fn.node)) return null;
    const binding = fn.parentPath.scope.getBinding(fn.node.id.name);
    const index = fn.node.params.findIndex((p) => (p.left || p).name === name);
    let type = null;
    for (const reference of binding?.referencePaths || []) {
      const call = reference.parentPath;
      if (!call.isCallExpression() || call.node.callee !== reference.node)
        continue;
      const actual = infer(
        call.node.arguments[index],
        call.scope,
        new Set(seen).add(fn.node),
      );
      if (!compatible(actual, type)) return null;
      type ||= actual;
    }
    return type;
  }
  function functionReturns(fn) {
    const returns = [];
    fn.traverse({
      ReturnStatement(p) {
        if (p.getFunctionParent() === fn) returns.push(p);
      },
    });
    return returns;
  }
  function inferReturn(fn, seen = new Set()) {
    const explicit =
      annotatedType(fn.node.returnType?.typeAnnotation) ||
      normalizeType(docsFor(fn).returns);
    if (explicit) return explicit;
    if (seen.has(fn.node)) return null;
    const next = new Set(seen).add(fn.node);
    if (fn.node.body.type !== 'BlockStatement')
      return infer(fn.node.body, fn.scope, next);
    const types = functionReturns(fn).map((p) =>
      p.node.argument ? infer(p.node.argument, p.scope, next) : 'void',
    );
    if (!types.length) return 'void';
    if (types.some((t) => !t) || types.some((t) => !compatible(t, types[0])))
      return null;
    return types[0];
  }
  function related(node, message) {
    return diagnostic(
      node,
      'TYPE_ORIGIN',
      message,
      nodeFiles.get(node) || filename,
      'info',
      'compatibility',
    );
  }
  function sequenceFlow(statements) {
    let outcomes = new Set(['next']);
    for (const statement of statements) {
      if (!outcomes.delete('next')) break;
      for (const outcome of returnFlow(statement)) outcomes.add(outcome);
    }
    return outcomes;
  }
  function returnFlow(node) {
    if (!node) return new Set(['next']);
    if (node.type === 'ReturnStatement')
      return new Set([node.argument ? 'value' : 'empty']);
    if (node.type === 'BreakStatement') return new Set(['break']);
    if (node.type === 'ContinueStatement') return new Set(['continue']);
    if (node.type === 'BlockStatement') return sequenceFlow(node.body);
    if (node.type === 'IfStatement') {
      if (node.test.type === 'BooleanLiteral')
        return returnFlow(node.test.value ? node.consequent : node.alternate);
      return new Set([
        ...returnFlow(node.consequent),
        ...returnFlow(node.alternate),
      ]);
    }
    if (node.type === 'SwitchStatement') {
      const outcomes = new Set(node.cases.some((c) => !c.test) ? [] : ['next']);
      for (let i = 0; i < node.cases.length; i++) {
        const statements = node.cases.slice(i).flatMap((c) => c.consequent);
        for (const outcome of sequenceFlow(statements))
          outcomes.add(outcome === 'break' ? 'next' : outcome);
      }
      return outcomes;
    }
    // Loops may execute zero times. Require a fallback return after a loop.
    if (
      ['ForStatement', 'WhileStatement', 'ForOfStatement'].includes(node.type)
    )
      return new Set([
        'next',
        ...[...returnFlow(node.body)].filter(
          (x) => x === 'value' || x === 'empty',
        ),
      ]);
    return new Set(['next']);
  }
  function definitelyReturns(node) {
    const outcomes = returnFlow(node);
    return outcomes.size === 1 && outcomes.has('value');
  }
  function checkArguments(p, fn) {
    const params = fn.node.params;
    const args = p.node.arguments;
    const required = params.reduce(
      (last, param, i) =>
        param.type === 'AssignmentPattern' || param.type === 'RestElement'
          ? last
          : i + 1,
      0,
    );
    if (args.length < required)
      report(
        p.node,
        'RUST_REQUIRED_ARGUMENTS',
        `Missing required argument：JavaScript 可省略參數，但目前 Rust 子集要求 ${p.node.callee.name} 至少傳入 ${required} 個參數，目前為 ${args.length} 個。`,
        'error',
        'compatibility',
      );
    if (
      args.length > params.length &&
      !params.some((param) => param.type === 'RestElement')
    )
      report(
        p.node,
        'RUST_ARGUMENT_COUNT',
        '合法 JavaScript 的額外參數目前無法轉譯為 Rust；請移除多餘參數。',
        'error',
        'compatibility',
      );
    const docs = docsFor(fn);
    params.forEach((parameter, i) => {
      const name = (parameter.left || parameter).name;
      const expected =
        annotatedType(parameter.left || parameter) ||
        normalizeType(docs.params[name]) ||
        (parameter.type === 'AssignmentPattern'
          ? infer(parameter.right, fn.scope)
          : null);
      const actual = infer(args[i], p.scope);
      if (!compatible(actual, expected))
        report(
          args[i],
          'JS_ARGUMENT_TYPE',
          `參數 ${name} 預期 ${expected}，實際為 ${actual}。`,
          'error',
          'javascript',
          {
            hint: '請傳入符合宣告型別的值，或修正函式的型別註記。',
            related: [related(parameter, `參數 ${name} 的型別來源`)],
          },
        );
    });
  }
  traverse(result.ast, {
    TSType(p) {
      const type = p.node.type;
      if (
        [
          'TSNumberKeyword',
          'TSStringKeyword',
          'TSBooleanKeyword',
          'TSVoidKeyword',
          'TSArrayType',
          'TSNullKeyword',
          'TSUndefinedKeyword',
        ].includes(type)
      )
        return;
      if (type === 'TSUnionType' && annotatedType(p.node) && p.node.types.some(t => ['TSNullKeyword', 'TSUndefinedKeyword'].includes(t.type))) return;
      if (type === 'TSTypeReference' && ['Map', 'Set'].includes(p.node.typeName.name) && p.node.typeParameters?.params.length === (p.node.typeName.name === 'Map' ? 2 : 1)) return;
      if (type === 'TSExpressionWithTypeArguments' && !p.node.typeParameters)
        return;
      if (
        type === 'TSTypeReference' &&
        p.node.typeName.type === 'Identifier' &&
        !p.node.typeParameters
      ) {
        if (
          !namedTypes.has(p.node.typeName.name) &&
          p.scope.getBinding(p.node.typeName.name)?.kind !== 'module'
        )
          report(
            p.node,
            'RUST_UNKNOWN_TYPE',
            `找不到具名型別 ${p.node.typeName.name} 的定義。`,
            'error',
            'compatibility',
            { hint: '請在此檔案定義型別，或改用已支援的明確型別。' },
          );
        return;
      }
      report(
        p.node,
        'RUST_UNSUPPORTED_TYPE',
        `型別註記 ${type} 尚未支援，不能默默替換成數值型別。`,
        'error',
        'compatibility',
        {
          hint: '請使用明確的 number、string、boolean、陣列或已定義的具名型別。',
        },
      );
    },
    Function(p) {
      if (p.node.body?.type !== 'BlockStatement' || p.node.id?.name === 'main')
        return;
      const returns = functionReturns(p);
      let first;
      for (const ret of returns) {
        const actual = ret.node.argument
          ? infer(ret.node.argument, ret.scope)
          : 'void';
        if (first && !['null', 'undefined'].includes(actual) && !['null', 'undefined'].includes(first.type) && !compatible(actual, first.type)) {
          report(
            ret.node,
            'RUST_RETURN_TYPE',
            `Conflicting return types：同一函式分別回傳 ${first.type} 與 ${actual}。`,
            'error',
            'compatibility',
            {
              hint: '請讓各回傳路徑使用相同型別。',
              related: [related(first.node, '另一個回傳值位於這裡')],
            },
          );
        }
        if (actual && !first) first = { type: actual, node: ret.node };
      }
      const result = inferReturn(p);
      if (
        result &&
        result !== 'void' &&
        !definitelyReturns(p.node.body)
      )
        report(
          p.node.returnType || p.node,
          'RUST_MISSING_RETURN',
          `函式預期回傳 ${result}，但部分路徑可能沒有回傳值；目前無法將 undefined 合併為此 Rust 型別。`,
          'error',
          'compatibility',
          { hint: '請補上最末端的 return，或確保所有條件分支都回傳相同型別。' },
        );
    },
    enter(p) {
      if (unsupportedNodes.has(p.node.type))
        report(
          p.node,
          'RUST_UNSUPPORTED_SYNTAX',
          `Unsupported AST node: ${p.node.type}（合法 JavaScript，但目前不支援轉譯）`,
          'error',
          'compatibility',
        );
    },
    ReferencedIdentifier(p) {
      if (
        p.findParent(
          (parent) =>
            parent.isTSType?.() ||
            [
              'TSInterfaceDeclaration',
              'TSTypeAliasDeclaration',
              'TSClassImplements',
              'TSMethodSignature',
              'TSPropertySignature',
            ].includes(parent.node.type),
        )
      )
        return;
      const name = p.node.name;
      const binding = p.scope.getBinding(name);
      if (!binding && !globals.has(name) && !enums.has(name)) {
        report(
          p.node,
          unsupportedGlobals.has(name)
            ? 'RUST_UNSUPPORTED_GLOBAL'
            : 'JS_UNDECLARED',
          unsupportedGlobals.has(name)
            ? `${name} 是 JavaScript API，但目前尚未對接 Rust。`
            : `未宣告的變數或函式：${name}。`,
          'error',
          unsupportedGlobals.has(name) ? 'compatibility' : 'javascript',
        );
      }
      if (
        binding &&
        ['const', 'let'].includes(binding.kind) &&
        p.getFunctionParent() === binding.path.getFunctionParent()
      ) {
        const init = binding.path.node.init;
        if (
          p.node.start < binding.identifier.start ||
          (init && p.node.start >= init.start && p.node.end <= init.end)
        )
          report(
            p.node,
            'JS_BEFORE_DECLARATION',
            `${name} 在 let/const 初始化完成前被使用。`,
          );
      }
    },
    'AssignmentExpression|UpdateExpression'(p) {
      const target = p.node.left || p.node.argument;
      if (target.type !== 'Identifier') return;
      const binding = p.scope.getBinding(target.name);
      if (!binding)
        report(target, 'JS_UNDECLARED', `未宣告的變數：${target.name}。`);
      else if (binding.kind === 'const' || binding.kind === 'module')
        report(
          target,
          'JS_CONST_ASSIGNMENT',
          `不能重新指定 ${binding.kind === 'module' ? '匯入' : 'const'} 變數 ${target.name}。`,
        );
      else if (p.node.operator === '=') {
        const expected = infer(target, p.scope),
          actual = infer(p.node.right, p.scope);
        if (!compatible(actual, expected))
          report(
            p.node.right,
            'RUST_VARIABLE_TYPE',
            `變數 ${target.name} 從 ${expected} 改為 ${actual}；目前 Rust 子集不支援改變變數型別。`,
            'error',
            'compatibility',
          );
      }
    },
    VariableDeclarator(p) {
      const init = p.node.init;
      if (init?.type === 'CallExpression' && ['sort', 'reverse', 'set', 'add'].includes(init.callee.property?.name) && init.callee.object.type === 'Identifier') {
        const original = p.scope.getBinding(init.callee.object.name), alias = p.scope.getBinding(p.node.id.name);
        const mutators = new Set(['push', 'pop', 'splice', 'reverse', 'sort', 'set', 'add', 'delete', 'clear']);
        const mutation = [...(original?.referencePaths || []), ...(alias?.referencePaths || [])].find(ref => ref.node.start > init.end && (ref.parentPath.isMemberExpression() && (ref.parentPath.parentPath.isAssignmentExpression() || ref.parentPath.parentPath.isUpdateExpression() || ref.parentPath.parentPath.isCallExpression() && mutators.has(ref.parentPath.node.property.name))));
        if (mutation) report(init, 'RUST_SHARED_ALIAS', '此回傳值與原資料共享參照；後續修改別名目前無法保持 JavaScript 語意。', 'error', 'compatibility', { hint: '請先使用 slice() 建立獨立副本，或直接操作原資料。' });
      }
      const expected = annotatedType(p.node.id),
        actual = infer(p.node.init, p.scope);
      if (!compatible(actual, expected))
        report(
          p.node.init,
          'JS_DECLARATION_TYPE',
          `宣告預期 ${expected}，初始值為 ${actual}。`,
        );
    },
    AssignmentPattern(p) {
      const expected = annotatedType(p.node.left),
        actual = infer(p.node.right, p.scope);
      if (!compatible(actual, expected))
        report(
          p.node.right,
          'JS_DEFAULT_TYPE',
          `預設值預期 ${expected}，實際為 ${actual}。`,
        );
    },
    ReturnStatement(p) {
      const fn = p.getFunctionParent();
      if (!fn) return;
      const expected =
        annotatedType(fn.node.returnType?.typeAnnotation) ||
        normalizeType(docsFor(fn).returns);
      const actual = p.node.argument ? infer(p.node.argument, p.scope) : 'void';
      if (!compatible(actual, expected))
        report(
          p.node,
          'JS_RETURN_TYPE',
          `回傳值預期 ${expected}，實際為 ${actual}。`,
        );
    },
    CallExpression(p) {
      if (p.node.callee.type === 'Identifier') {
        const fn = bindingFunction(p.scope.getBinding(p.node.callee.name));
        if (fn) {
          checkArguments(p, fn);
          const previous = callTypes.get(fn.node) || [];
          p.node.arguments.forEach((arg, i) => {
            const actual = infer(arg, p.scope);
            const declared = annotatedType((fn?.node.params[i]?.left || fn?.node.params[i])) || normalizeType(fn ? docsFor(fn).params[(fn.node.params[i]?.left || fn.node.params[i])?.name] : null);
            if (!declared?.startsWith('maybe:') && !compatible(actual, previous[i]))
              report(
                arg,
                'RUST_CALL_TYPE',
                `Conflicting argument types：${p.node.callee.name} 的第 ${i + 1} 個參數分別使用 ${previous[i]} 與 ${actual}，目前需要一致型別。`,
                'error',
                'compatibility',
              );
            if (actual && !previous[i]) previous[i] = actual;
          });
          callTypes.set(fn.node, previous);
        }
        return;
      }
      if (p.node.callee.type !== 'MemberExpression' || p.node.callee.computed)
        return;
      const { object, property } = p.node.callee;
      const method = property.name;
      const receiver = infer(object, p.scope);
      const array = receiver?.startsWith('array:');
      const args = p.node.arguments;
      if ((receiver?.startsWith('map:') || receiver?.startsWith('set:')) && ['keys', 'values'].includes(method) && !(p.parentPath.isCallExpression() && p.parentPath.node.callee.object?.name === 'Array' && p.parentPath.node.callee.property?.name === 'from')) report(p.node, 'RUST_COLLECTION_ITERATOR', 'keys()/values() 目前需立即以 Array.from() 轉為陣列，不支援可變動的迭代器。', 'error', 'compatibility');
      if (array && method === 'sort' && args[0] && ['ArrowFunctionExpression', 'FunctionExpression'].includes(args[0].type)) {
        const callback = p.get('arguments.0');
        callback.traverse({
          'AssignmentExpression|UpdateExpression'(q) {
            const target = q.node.left || q.node.argument;
            const binding = target.type === 'Identifier' ? q.scope.getBinding(target.name) : null;
            if (!binding || !binding.path.findParent(parent => parent === callback)) report(q.node, 'RUST_COMPARATOR_EFFECT', '排序比較函式不能修改外部資料；Rust 與 JS 的比較呼叫次數可能不同。', 'error', 'compatibility');
          },
          CallExpression(q) {
            if (q.node.callee.object?.name !== 'Math') report(q.node, 'RUST_COMPARATOR_EFFECT', '排序比較函式目前僅支援無副作用的運算與 Math 方法。', 'error', 'compatibility');
          },
        });
      }
      if (object.name === 'Array' && method !== 'from') report(property, 'RUST_ARRAY_STATIC', 'Array 目前僅支援 Array.from。', 'error', 'compatibility');
      if (receiver?.startsWith('map:') || receiver?.startsWith('set:')) {
        const kind = receiver.slice(0, 3), parts = receiver.slice(4).split('|');
        const allowed = kind === 'map' ? ['set', 'get', 'has', 'delete', 'clear', 'keys', 'values'] : ['add', 'has', 'delete', 'clear', 'keys', 'values'];
        if (!allowed.includes(method)) report(property, 'RUST_COLLECTION_METHOD', `${kind}.${method} 尚未支援。`, 'error', 'compatibility');
        for (const [i, arg] of args.entries()) if (parts[i] && parts[i] !== '?' && !compatible(infer(arg, p.scope), parts[i])) report(arg, 'JS_COLLECTION_TYPE', `集合參數預期 ${parts[i]}。`);
      }
      if (object.name === 'Math' && !p.scope.getBinding('Math')) {
        const count = { floor: 1, sqrt: 1, abs: 1, pow: 2, min: 2, max: 2 }[
          method
        ];
        if (!count)
          report(
            property,
            'RUST_MATH_METHOD',
            `Math.${method} 目前不支援。`,
            'error',
            'compatibility',
          );
        else if (args.length !== count)
          report(
            p.node,
            'RUST_METHOD_ARGUMENTS',
            `目前 Math.${method} 需要 ${count} 個參數。`,
            'error',
            'compatibility',
          );
      }
      if (receiver === 'string' && !stringMethods.has(method))
        report(
          property,
          'RUST_STRING_METHOD',
          `字串方法 ${method} 目前不支援；請檢查拼字與接收值型別。`,
          'error',
          'compatibility',
        );
      if (array && !arrayMethods.has(method))
        report(
          property,
          'RUST_ARRAY_METHOD',
          `Unsupported array method: ${method}；請檢查拼字或支援範圍。`,
          'error',
          'compatibility',
        );
      if (
        receiver &&
        receiver !== 'string' &&
        !array &&
        !receiver.startsWith('map:') && !receiver.startsWith('set:') && !receiver.startsWith('maybe:') &&
        (arrayMethods.has(method) || stringMethods.has(method))
      )
        report(
          object,
          'JS_METHOD_RECEIVER',
          `${receiver} 無法使用 ${method} 方法。`,
        );
      if (array && callbacks.has(method)) {
        const callback = p.node.arguments[0];
        if (
          !callback ||
          !['ArrowFunctionExpression', 'FunctionExpression'].includes(
            callback.type,
          )
        )
          report(
            p.node,
            'RUST_CALLBACK',
            `${method} 需要內嵌函式回呼。`,
            'error',
            'compatibility',
          );
        else if (callback.params.length > (method === 'reduce' ? 3 : 2))
          report(
            callback,
            'RUST_CALLBACK_PARAMS',
            `Array callbacks support up to ${method === 'reduce' ? 3 : 2} identifier parameters`,
            'error',
            'compatibility',
          );
        if (args.length > (method === 'reduce' ? 2 : 1))
          report(
            p.node,
            'RUST_METHOD_ARGUMENTS',
            `${method} 的額外參數（例如 thisArg）目前不支援。`,
            'error',
            'compatibility',
          );
      }
      if (array && ['push', 'splice', 'includes', 'indexOf'].includes(method)) {
        const element = receiver.slice('array:'.length);
        const values =
          method === 'splice'
            ? args.slice(2)
            : ['includes', 'indexOf'].includes(method)
              ? args.slice(0, 1)
              : args;
        for (const value of values) {
          const actual = infer(value, p.scope);
          if (element !== '?' && !compatible(actual, element))
            report(
              value,
              'RUST_ARRAY_ELEMENT',
              `${method} 元素預期 ${element}，實際為 ${actual}。`,
              'error',
              'compatibility',
            );
        }
      }
      const numericArguments =
        array && ['slice', 'splice'].includes(method)
          ? args.slice(0, 2)
          : array && ['includes', 'indexOf'].includes(method)
            ? args.slice(1, 2)
            : receiver === 'string' && method === 'split'
              ? args.slice(1, 2)
              : [];
      for (const argument of numericArguments) {
        if (argument.type === 'Identifier' && argument.name === 'undefined') continue;
        const actual = infer(argument, p.scope);
        if (actual && actual !== 'number')
          report(
            argument,
            'RUST_INDEX_TYPE',
            '索引／數量需要 number；目前不支援 JavaScript 隱式轉型。',
            'error',
            'compatibility',
          );
      }
      if (
        receiver === 'string' &&
        ['split', 'includes', 'startsWith', 'endsWith'].includes(method) &&
        args[0]
      ) {
        const actual = infer(args[0], p.scope);
        if (actual && actual !== 'string' && !(method === 'split' && actual === 'undefined'))
          report(
            args[0],
            'RUST_STRING_ARGUMENT',
            `${method} 的文字參數需要 string，實際為 ${actual}；目前不支援 JavaScript 隱式轉型。`,
            'error',
            'compatibility',
          );
      }
      const maxArguments = array
        ? { pop: 0, slice: 2, includes: 2, indexOf: 2, join: 1, reverse: 0, sort: 1, flat: 1 }[method]
        : receiver === 'string'
          ? {
              split: 2,
              trim: 0,
              toLowerCase: 0,
              toUpperCase: 0,
              startsWith: 1,
              endsWith: 1,
              includes: 1,
            }[method]
          : undefined;
      if (maxArguments !== undefined && args.length > maxArguments)
        report(
          p.node,
          'RUST_METHOD_ARGUMENTS',
          `${method} 的額外參數目前不支援。`,
          'error',
          'compatibility',
        );
      if (
        receiver === 'string' &&
        method === 'split' &&
        p.node.arguments[0]?.type === 'RegExpLiteral'
      )
        report(
          p.node.arguments[0],
          'RUST_SPLIT_REGEX',
          'split supports string separators, not regular expressions',
          'error',
          'compatibility',
        );
      if (array && method === 'reduce' && p.node.arguments.length === 1) {
        const binding =
          object.type === 'Identifier' ? p.scope.getBinding(object.name) : null;
        const initial =
          object.type === 'ArrayExpression' ? object : binding?.path.node.init;
        if (
          initial?.type === 'ArrayExpression' &&
          initial.elements.length === 0
        )
          report(
            p.node,
            'JS_EMPTY_REDUCE',
            '空陣列 reduce 未提供初始值，執行時可能失敗。',
            'warning',
          );
      }
    },
    ConditionalExpression(p) {
      const a = infer(p.node.consequent, p.scope),
        b = infer(p.node.alternate, p.scope);
      if (!['null', 'undefined'].includes(a) && !['null', 'undefined'].includes(b) && !compatible(a, b))
        report(
          p.node,
          'RUST_CONDITIONAL_TYPE',
          `條件運算的兩個結果為 ${a} 與 ${b}；Rust 子集需要相同型別。`,
          'error',
          'compatibility',
        );
    },
    ImportDeclaration(p) {
      const source = p.node.source.value;
      if (!source.startsWith('.')) {
        report(
          p.node,
          'RUST_EXTERNAL_MODULE',
          `Unsupported external module: ${source}`,
          'error',
          'compatibility',
        );
        return;
      }
      if (
        p.node.specifiers.some(
          (spec) => spec.type === 'ImportNamespaceSpecifier',
        )
      )
        report(
          p.node,
          'RUST_NAMESPACE_IMPORT',
          'Namespace imports are unsupported; use named imports',
          'error',
          'compatibility',
        );
      if (!options.files) return;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filename), source),
      );
      if (
        !Object.keys(options.files).some(
          (file) => path.posix.normalize(file) === resolved,
        )
      )
        report(
          p.node.source,
          'JS_IMPORT_NOT_FOUND',
          `找不到匯入檔案：${resolved}。`,
        );
      else {
        const module = moduleRecord(resolved);
        for (const spec of p.node.specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') continue;
          const exported =
            spec.type === 'ImportDefaultSpecifier'
              ? 'default'
              : spec.imported.name;
          if (module && !module.exports.has(exported))
            report(
              spec,
              'JS_IMPORT_EXPORT',
              `Unknown export ${exported} in ${resolved}`,
            );
        }
      }
    },
  });
  const unique = new Map(
    diagnostics.map((d) => [`${d.code}:${d.line}:${d.column}`, d]),
  );
  return {
    ast: result.ast,
    diagnostics: [...unique.values()].sort(
      (a, b) => a.line - b.line || a.column - b.column,
    ),
  };
}

export function diagnosticsFromError(error, filename = 'source') {
  if (error.diagnostics) return error.diagnostics;
  const match = error.message?.match(/\(([^()\n]+):([0-9]+):([0-9]+)\)/);
  const loc = error.sourceLocation || match?.slice(2).map(Number);
  const item = diagnostic(
    null,
    'RUST_COMPATIBILITY',
    error.message || String(error),
    error.sourceFilename || (match?.[1] !== 'source' && match?.[1]) || filename,
    'error',
    'compatibility',
  );
  if (match && item.message.endsWith(match[0]))
    item.message = item.message.slice(0, -match[0].length).trimEnd();
  if (loc) {
    item.line = Number(loc[0]);
    item.column = Number(loc[1]);
    item.endLine = item.line;
    item.endColumn = item.column + 1;
  }
  return [item];
}

export function validateJavaScript(source, options = {}) {
  const analysis = analyzeJavaScript(source, options);
  const diagnostics = [...analysis.diagnostics];
  if (
    !diagnostics.some((d) => d.severity === 'error') &&
    options.checkCompatibility !== false
  ) {
    try {
      new RustEmitter(options).emitProgramWithAst(analysis.ast);
    } catch (error) {
      diagnostics.push(...diagnosticsFromError(error, options.filename));
    }
  }
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

export function validateProject(files, options = {}) {
  const diagnostics = Object.entries(files).flatMap(
    ([filename, source]) =>
      analyzeJavaScript(source, { ...options, filename, files }).diagnostics,
  );
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

export function assertValid(result) {
  if (result.diagnostics.some((d) => d.severity === 'error'))
    throw new JavaScriptValidationError(result.diagnostics);
}
