/** Owned data types for the homogeneous subset. */
export const missingType = type => type === 'null' || type === 'undefined';
export const maybeInner = type => type?.match(/^__js2rust::Maybe<(.+)>$/)?.[1] || null;
export const ownedType = type => type === '&str' || type === "&'static str" ? 'String' : type;
export function mergeTypes(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (missingType(a) || missingType(b) || maybeInner(a) || maybeInner(b)) {
    const innerA = maybeInner(a) || (missingType(a) ? null : ownedType(a));
    const innerB = maybeInner(b) || (missingType(b) ? null : ownedType(b));
    const inner = mergeTypes(innerA, innerB) || 'i64';
    return `__js2rust::Maybe<${inner}>`;
  }
  if ([a, b].every(t => ['f64', 'i64'].includes(t))) return 'f64';
  if ([a, b].every(t => ['String', '&str', "&'static str"].includes(t))) return 'String';
  if ([a, b].every(t => t.startsWith('Vec<'))) {
    const inner = mergeTypes(a.slice(4, -1), b.slice(4, -1));
    return inner ? `Vec<${inner}>` : null;
  }
  return null;
}
export function collectionParts(type) {
  const match = type?.replace(/^&(?:mut )?/, '').match(/^__js2rust::(Map|Set)<(.+)>$/);
  if (!match) return null;
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < match[2].length; i++) {
    const c = match[2][i];
    if (c === '<') depth++;
    if (c === '>') depth--;
    if (c === ',' && depth === 0) { parts.push(match[2].slice(start, i).trim()); start = i + 1; }
  }
  parts.push(match[2].slice(start).trim());
  return { kind: match[1], parts };
}
export function flatDepth(node, fail) {
  const arg = node.arguments[0];
  if (!arg || arg.type === 'Identifier' && arg.name === 'undefined') return 1;
  if (arg.type === 'Identifier' && arg.name === 'Infinity') return Infinity;
  if (arg.type === 'NumericLiteral') return Math.max(0, Math.trunc(arg.value));
  if (arg.type === 'UnaryExpression' && ['-', '+'].includes(arg.operator) && arg.argument.type === 'NumericLiteral') return Math.max(0, Math.trunc((arg.operator === '-' ? -1 : 1) * arg.argument.value));
  fail(arg, 'flat depth currently requires a numeric literal or Infinity');
}
