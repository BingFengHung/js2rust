/**
 * Type Mapping & JSDoc Parser for js-to-rust
 */

export const RUST_TYPE_MAP = {
  // Numbers
  'number': 'f64',
  'float': 'f64',
  'f64': 'f64',
  'f32': 'f32',
  'int': 'i64',
  'integer': 'i64',
  'i64': 'i64',
  'i32': 'i32',
  'usize': 'usize',

  // Booleans
  'boolean': 'bool',
  'bool': 'bool',

  // Strings
  'string': '&str',
  'String': 'String',

  // Arrays
  'number[]': '&[f64]',
  'int[]': '&[i64]',
  'i64[]': '&[i64]',
  'Array<number>': '&[f64]',
  'Array<int>': '&[i64]',
  'Array<i64>': '&[i64]',
  'string[]': '&[&str]',

  // Void
  'void': '()',
};

/**
 * Maps a JSDoc or inferred type string to a Rust type.
 * @param {string} jsType
 * @param {boolean} isReturn - whether this type is for a return position
 * @returns {string}
 */
export function mapToRustType(jsType, isReturn = false) {
  if (!jsType) return 'f64'; // Default to f64 for numerical algorithms

  const trimmed = jsType.trim();

  // If return type is slice &[T], convert to owned Vec<T>
  if (isReturn) {
    if (trimmed === 'number[]' || trimmed === 'Array<number>') return 'Vec<f64>';
    if (trimmed === 'int[]' || trimmed === 'i64[]' || trimmed === 'Array<int>') return 'Vec<i64>';
    if (trimmed === 'string') return 'String';
  }

  return RUST_TYPE_MAP[trimmed] || trimmed;
}

/**
 * Extracts JSDoc @param and @returns tags from AST leading comments.
 * @param {Array} leadingComments
 * @returns {{ params: Record<string, string>, returns: string | null }}
 */
export function parseJSDoc(leadingComments) {
  const result = {
    params: {},
    returns: null,
  };

  if (!leadingComments || leadingComments.length === 0) {
    return result;
  }

  const jsdocComment = leadingComments.find(
    (c) => c.type === 'CommentBlock' && c.value.startsWith('*')
  );

  if (!jsdocComment) {
    return result;
  }

  const lines = jsdocComment.value.split('\n');
  for (const line of lines) {
    const paramMatch = line.match(/@param\s+\{([^}]+)\}\s+([a-zA-Z0-9_$]+)/);
    if (paramMatch) {
      result.params[paramMatch[2]] = paramMatch[1].trim();
    }

    const returnMatch = line.match(/@returns?\s+\{([^}]+)\}/);
    if (returnMatch) {
      result.returns = returnMatch[1].trim();
    }
  }

  return result;
}
