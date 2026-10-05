(() => {
function encodeValue(value, depth = 0) {
  if (depth > 40) throw new Error('比較資料超過最大巢狀層數。');
  if (value === undefined) return { $js2rust: 'undefined' };
  if (Object.is(value, -0)) return { $js2rust: '-0' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $js2rust: String(value) };
  if (value instanceof Map) return { $js2rust: 'Map', entries: Array.from(value, ([k, v]) => [encodeValue(k, depth + 1), encodeValue(v, depth + 1)]) };
  if (value instanceof Set) return { $js2rust: 'Set', values: Array.from(value, v => encodeValue(v, depth + 1)) };
  if (Array.isArray(value)) return Array.from(value, v => encodeValue(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v, depth + 1)]));
  if (value === null || ['number', 'boolean', 'string'].includes(typeof value)) return value;
  throw new Error('比較結果需要基本資料、陣列、Map 或 Set。');
}
function parseRustResults(stdout) {
  const results = [], logs = [];
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith('__JS2RUST_LOG__')) logs.push(JSON.parse(line.slice('__JS2RUST_LOG__'.length)));
    if (line.startsWith('__JS2RUST_RESULT__')) results.push({ value: JSON.parse(line.slice('__JS2RUST_RESULT__'.length)), logs: logs.splice(0) });
  }
  return results;
}
const resultsEqual = (a, b) => !a?.error && !b?.error && JSON.stringify(a) === JSON.stringify(b);
function displayValue(value) {
  if (value?.$js2rust === 'Map') return `Map { ${value.entries.map(([k, v]) => `${displayValue(k)} => ${displayValue(v)}`).join(', ')} }`;
  if (value?.$js2rust === 'Set') return `Set { ${value.values.map(displayValue).join(', ')} }`;
  if (value?.$js2rust) return value.$js2rust;
  if (Array.isArray(value)) return `[${value.map(displayValue).join(', ')}]`;
  return JSON.stringify(value);
}
function formatResult(result) {
  if (!result) return '未回傳結果';
  if (result.error) return `錯誤：${result.error}`;
  return `回傳：${displayValue(result.value)}\n輸出：${result.logs.length ? '\n' + result.logs.map(values => values.map(displayValue).join(' ')).join('\n') : '（無）'}`;
}

globalThis.JS2RUST_COMPARISON = { encodeValue, parseRustResults, resultsEqual, formatResult };
})();
