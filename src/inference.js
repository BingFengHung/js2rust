/**
 * Smart Type Inference Engine for js-to-rust
 * Infers parameter and variable types without requiring explicit JSDoc annotations.
 */

/**
 * Common semantic naming conventions for JavaScript parameters
 */
const NAME_HEURISTICS = [
  { regex: /^(str|text|msg|message|greet|greeting|name|title|desc|url|word|prefix|suffix)$/i, type: 'string' },
  { regex: /^(is|has|can|should|enable|disable)[A-Z]/, type: 'bool' },
  { regex: /^(flag|valid|ok|found|active|ready|done)$/i, type: 'bool' },
  { regex: /^(nums|numbers|scores|items|list|arr|array|indices|elements)$/i, type: 'int[]' },
  { regex: /^(count|idx|index|len|length|size|total|sum|num|n|i|j|k|code|status|id|age|year)$/i, type: 'int' },
  { regex: /^(price|rate|ratio|percent|weight|dist|distance|x|y|z|radius|avg|average)$/i, type: 'float' },
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
export function inferParameterType(fnName, paramIndex, paramName, paramNode, fnNode, ast) {
  // 1. Check if parameter has default value: function foo(x = "hello")
  if (paramNode.type === 'AssignmentPattern') {
    const defaultVal = paramNode.right;
    const inferred = inferFromLiteral(defaultVal);
    if (inferred) return inferred;
  }

  // 2. Call-Site Analysis: Search callers across the entire program
  const callSiteType = inferFromCallSites(fnName, paramIndex, ast);
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
  if (node.type === 'ArrayExpression') {
    if (node.elements.length > 0) {
      const first = node.elements[0];
      if (first.type === 'StringLiteral') return 'string[]';
      if (first.type === 'NumericLiteral') {
        return String(first.value).includes('.') ? 'number[]' : 'int[]';
      }
    }
    return 'int[]';
  }

  return null;
}

/**
 * Scans the AST to find all calls to fnName(...) and looks at the argument passed at paramIndex
 */
function inferFromCallSites(fnName, paramIndex, ast) {
  if (!ast || !ast.program) return null;

  let inferred = null;

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === fnName
    ) {
      if (node.arguments && node.arguments.length > paramIndex) {
        const arg = node.arguments[paramIndex];
        const argType = inferFromLiteral(arg);
        if (argType) {
          inferred = argType;
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

  visit(ast.program);
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
        if (node.computed || (node.property && node.property.name === 'length')) {
          inferred = 'int[]';
          return;
        }
      }
    }

    // String method calls: param.toLowerCase(), param.trim(), etc.
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      if (node.callee.object.type === 'Identifier' && node.callee.object.name === paramName) {
        const method = node.callee.property.name;
        if (['trim', 'toLowerCase', 'toUpperCase', 'split', 'startsWith', 'endsWith', 'substring'].includes(method)) {
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
