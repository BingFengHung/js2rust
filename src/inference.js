import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
function annotationType(node) {
  const type = node?.typeAnnotation?.typeAnnotation || node;
  if (!type) return null;
  if (type.type === 'TSArrayType') {
    const element = annotationType(type.elementType);
    return element
      ? `${element === 'float' ? 'number' : element === 'bool' ? 'boolean' : element}[]`
      : null;
  }
  return (
    {
      TSNumberKeyword: 'float',
      TSStringKeyword: 'string',
      TSBooleanKeyword: 'bool',
    }[type.type] || null
  );
}
const analysisCache = new WeakMap();
function analysisFor(ast) {
  if (!analysisCache.has(ast)) {
    const calls = [];
    traverse(ast, {
      enter(p) {
        if (p.isCallExpression()) calls.push(p);
      },
    });
    analysisCache.set(ast, { calls });
  }
  return analysisCache.get(ast);
}

/**
 * Smart Type Inference Engine for js-to-rust
 * Infers parameter and variable types without requiring explicit JSDoc annotations.
 */

/**
 * Common semantic naming conventions for JavaScript parameters
 */
const NAME_HEURISTICS = [
  {
    regex:
      /^(str|text|msg|message|greet|greeting|name|title|desc|url|word|prefix|suffix)$/i,
    type: 'string',
  },
  { regex: /^(is|has|can|should|enable|disable)[A-Z]/, type: 'bool' },
  { regex: /^(flag|valid|ok|found|active|ready|done)$/i, type: 'bool' },
  {
    regex: /^(nums|numbers|scores|items|list|arr|array|indices|elements)$/i,
    type: 'int[]',
  },
  {
    regex:
      /^(count|idx|index|len|length|size|total|sum|num|n|i|j|k|code|status|id|age|year)$/i,
    type: 'int',
  },
  {
    regex:
      /^(price|rate|ratio|percent|weight|dist|distance|x|y|z|radius|avg|average)$/i,
    type: 'float',
  },
];

/**
 * Analyzes call sites and function AST to infer a parameter's Rust type.
 * @param {string} fnName - Name of the function
 * @param {number} paramIndex - Index of the parameter
 * @param {string} paramName - Name of the parameter identifier
 * @param {object} paramNode - The AST node of the parameter
 * @param {object} fnNode - The FunctionDeclaration AST node
 * @param {object} ast - The root AST Program node
 * @returns {string | null} Inferred type name or null if unknown
 */
export function inferParameterType(
  fnName,
  paramIndex,
  paramName,
  paramNode,
  fnNode,
  ast,
) {
  // 1. Check if parameter has default value: function foo(x = "hello")
  if (paramNode.type === 'AssignmentPattern') {
    const defaultVal = paramNode.right;
    const inferred = inferFromLiteral(defaultVal);
    if (inferred) {
      const called = inferFromCallSites(fnName, paramIndex, ast, fnNode);
      return mergeTypes(inferred, called) || inferred;
    }
  }

  // 2. Call-Site Analysis: Search callers across the entire program
  const callSiteType = inferFromCallSites(fnName, paramIndex, ast, fnNode);
  if (callSiteType) {
    return callSiteType;
  }

  // 3. Body Usage Analysis: Look at how paramName is used inside the function
  const bodyType = inferFromBodyUsage(paramName, fnNode);
  if (bodyType) {
    return bodyType;
  }

  // 4. Semantic Name Heuristic: Guess based on parameter naming conventions
  for (const { regex, type } of NAME_HEURISTICS) {
    if (regex.test(paramName)) {
      return type;
    }
  }

  return null;
}

/**
 * Infers type directly from an AST literal or expression
 */
export function inferFromLiteral(node) {
  if (!node) return null;

  if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
    return 'string';
  }
  if (node.type === 'BooleanLiteral') {
    return 'bool';
  }
  if (node.type === 'NumericLiteral') {
    return String(node.value).includes('.') ? 'float' : 'int';
  }
  if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator))
    return inferFromLiteral(node.argument);
  if (node.type === 'ArrayExpression') {
    const types = node.elements.map(inferFromLiteral);
    if (!types.length) return 'int[]';
    if (types.every((t) => ['int', 'float'].includes(t)))
      return types.includes('float') ? 'number[]' : 'int[]';
    if (types.every((t) => t === 'string')) return 'string[]';
    if (types.every((t) => t === 'bool')) return 'boolean[]';
  }

  return null;
}

/**
 * Scans the AST to find all calls to fnName(...) and looks at the argument passed at paramIndex
 */
function mergeTypes(a, b) {
  if (!a) return b;
  if (!b || a === b) return a;
  if (['int', 'float'].includes(a) && ['int', 'float'].includes(b))
    return 'float';
  return null;
}
function knownType(node, scope, ast, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  const next = new Set(seen).add(node);
  const literal = inferFromLiteral(node);
  if (literal) return literal;
  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (binding?.path.isVariableDeclarator())
      return (
        annotationType(binding.path.node.id) ||
        knownType(binding.path.node.init, binding.path.scope, ast, next)
      );
    if (binding?.kind === 'param') {
      const fn = binding.path.getFunctionParent();
      const index = fn.node.params.findIndex(
        (p) => (p.left || p).name === node.name,
      );
      const parameter = fn.node.params[index];
      const explicit = annotationType(parameter?.left || parameter);
      if (explicit) return explicit;
      return inferFromCallSites(fn.node.id?.name, index, ast, fn.node, next);
    }
  }
  if (node.type === 'BinaryExpression') {
    if (
      ['==', '===', '!=', '!==', '<', '<=', '>', '>='].includes(node.operator)
    )
      return 'bool';
    const left = knownType(node.left, scope, ast, next),
      right = knownType(node.right, scope, ast, next);
    if (node.operator === '+' && (left === 'string' || right === 'string'))
      return 'string';
    if (
      left &&
      right &&
      ['int', 'float'].includes(left) &&
      ['int', 'float'].includes(right)
    )
      return ['/', '**'].includes(node.operator)
        ? 'float'
        : mergeTypes(left, right);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    const binding = scope.getBinding(node.callee.name);
    if (binding?.path.isFunctionDeclaration()) {
      const fn = binding.path;
      const explicit = annotationType(fn.node.returnType);
      if (explicit) return explicit;
      const returns = [];
      fn.traverse({
        ReturnStatement(p) {
          if (p.getFunctionParent() === fn)
            returns.push(knownType(p.node.argument, p.scope, ast, next));
        },
      });
      return returns.reduce((type, value) => mergeTypes(type, value), null);
    }
  }
  return null;
}
function inferFromCallSites(fnName, paramIndex, ast, fnNode, seen = new Set()) {
  if (!ast?.program || !fnNode || seen.has(fnNode)) return null;
  let inferred = null;
  const next = new Set(seen).add(fnNode);
  for (const call of analysisFor(ast).calls) {
    if (call.node.callee.type !== 'Identifier') continue;
    const binding = call.scope.getBinding(call.node.callee.name);
    if (binding?.path.node !== fnNode) continue;
    const arg = call.node.arguments[paramIndex];
    const type = knownType(arg, call.scope, ast, next);
    if (!type) continue;
    const combined = mergeTypes(inferred, type);
    if (inferred && !combined) {
      const error = new Error(
        `Conflicting argument types for ${fnName} parameter ${paramIndex + 1}: ${inferred} and ${type}`,
      );
      error.sourceLocation = [arg.loc.start.line, arg.loc.start.column + 1];
      throw error;
    }
    inferred = combined;
  }
  return inferred;
}

/**
 * Analyzes operations on the variable within the function body
 */
function inferFromBodyUsage(paramName, fnNode) {
  if (!fnNode || !fnNode.body) return null;

  let inferred = null;

  const visit = (node) => {
    if (!node || typeof node !== 'object' || inferred) return;

    // Array indexing: param[i] or param.length
    if (node.type === 'MemberExpression') {
      if (node.object.type === 'Identifier' && node.object.name === paramName) {
        if (
          node.computed ||
          (node.property && node.property.name === 'length')
        ) {
          inferred = 'int[]';
          return;
        }
      }
    }

    // String method calls: param.toLowerCase(), param.trim(), etc.
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression'
    ) {
      if (
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === paramName
      ) {
        const method = node.callee.property.name;
        if (
          [
            'trim',
            'toLowerCase',
            'toUpperCase',
            'split',
            'startsWith',
            'endsWith',
            'substring',
          ].includes(method)
        ) {
          inferred = 'string';
          return;
        }
        if (['push', 'pop', 'slice', 'includes'].includes(method)) {
          inferred = 'int[]';
          return;
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(fnNode.body);
  return inferred;
}
