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

  // Arrays (immutable defaults)
  'number[]': '&[f64]',
  'int[]': '&[i64]',
  'i64[]': '&[i64]',
  'Array<number>': '&[f64]',
  'Array<int>': '&[i64]',
  'Array<i64>': '&[i64]',
  'string[]': '&[String]',
  'boolean[]': '&[bool]',

  // Void
  'void': '()',
};

/**
 * Maps a JSDoc or inferred type string to a Rust type.
 * @param {string} jsType
 * @param {boolean} isReturn - whether this type is for a return position
 * @param {boolean} isMut - whether this parameter is mutated (requires &mut)
 * @returns {string}
 */
export function mapToRustType(jsType, isReturn = false, isMut = false) {
  if (!jsType) return isMut ? '&mut f64' : 'f64';

  const trimmed = jsType.trim();
  if (trimmed.includes('|')) {
    const concrete = trimmed.split('|').map(t => t.trim()).filter(t => !['null', 'undefined'].includes(t));
    if (concrete.length === 1) return `__js2rust::Maybe<${mapToRustType(concrete[0], true).replace(/^&(?:'static )?str$/, 'String')}>`;
  }
  if (/^__js2rust::(?:Map|Set)</.test(trimmed) && !isReturn) return `&${isMut ? 'mut ' : ''}${trimmed}`;

  // If return type is slice &[T], convert to owned Vec<T>
  if (isReturn) {
    if (trimmed === 'number[]' || trimmed === 'Array<number>') return 'Vec<f64>';
    if (trimmed === 'int[]' || trimmed === 'i64[]' || trimmed === 'Array<int>') return 'Vec<i64>';
    if (trimmed === 'string') return "&'static str";
  }

  // If mutated array parameter, convert to &mut Vec<T> (slices do not support push/pop)
  if (isMut) {
    if (trimmed === 'int[]' || trimmed === 'i64[]' || trimmed === 'Array<int>') return '&mut Vec<i64>';
    if (trimmed === 'number[]' || trimmed === 'Array<number>') return '&mut Vec<f64>';
    if (trimmed === 'string[]') return '&mut Vec<String>';
  }

  return RUST_TYPE_MAP[trimmed] || trimmed;
}

/**
 * Extracts JSDoc @typedef, @property, @param, and @returns tags from AST leading comments.
 * Merges across ALL attached comments.
 * @param {Array} leadingComments
 * @returns {{
 *   params: Record<string, string>,
 *   returns: string | null,
 *   typedef: { name: string, properties: Array<{ name: string, type: string }> } | null
 * }}
 */
export function parseJSDoc(leadingComments) {
  const result = {
    params: {},
    returns: null,
    typedef: null,
    lifetime: null,
  };

  if (!leadingComments || leadingComments.length === 0) {
    return result;
  }

  for (const jsdocComment of leadingComments) {
    if (jsdocComment.type !== 'CommentBlock' || !jsdocComment.value.startsWith('*')) {
      continue;
    }

    const lines = jsdocComment.value.split('\n');
    let currentTypedef = null;

    for (const line of lines) {
      // 1. @typedef {Object} StructName
      const typedefMatch = line.match(/@typedef\s+\{([^}]+)\}\s+([a-zA-Z0-9_$]+)/);
      if (typedefMatch) {
        currentTypedef = {
          name: typedefMatch[2],
          properties: [],
        };
        result.typedef = currentTypedef;
      }

      // 2. @property {type} propName
      const propMatch = line.match(/@property\s+\{([^}]+)\}\s+([a-zA-Z0-9_$]+)/);
      if (propMatch && currentTypedef) {
        currentTypedef.properties.push({
          name: propMatch[2],
          type: mapToRustType(propMatch[1].trim()),
        });
      }

      // 3. @param {type} paramName
      const paramMatch = line.match(/@param\s+\{([^}]+)\}\s+([a-zA-Z0-9_$]+)/);
      if (paramMatch) {
        result.params[paramMatch[2]] = paramMatch[1].trim();
      }

      // 4. @returns {type}
      const returnMatch = line.match(/@returns?\s+\{([^}]+)\}/);
      if (returnMatch) {
        result.returns = returnMatch[1].trim();
      }

      // 5. @lifetime 'a or @lifetime 'a, 'b
      const lifetimeMatch = line.match(/@lifetime\s+([^\n\r]+)/);
      if (lifetimeMatch) {
        result.lifetime = lifetimeMatch[1].trim();
      }
    }
  }

  return result;
}
