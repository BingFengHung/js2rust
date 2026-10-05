/** Source ranges for generated Rust. Helpers and generated scaffolding stay unmapped. */
export function createMappingSession() {
  const origins = [];
  return {
    origins,
    wrap(code, node, filename) {
      if (!code || !node?.loc || ['Program', 'BlockStatement', 'EmptyStatement'].includes(node.type)) return code;
      const id = origins.length;
      origins.push({ filename: filename || 'source', line: node.loc.start.line, column: node.loc.start.column + 1, endLine: node.loc.end.line, endColumn: node.loc.end.column + 1 });
      return `\u0001+${id}\u0002${code}\u0001-${id}\u0002`;
    },
  };
}

export function extractSourceMap(marked, session, generatedFile = 'src/main.rs') {
  let code = '';
  let line = 1, column = 1;
  const stack = [];
  const mappings = [];
  const pattern = /\u0001([+-])(\d+)\u0002/g;
  let cursor = 0;
  const append = (text) => {
    code += text;
    const lines = text.split('\n');
    if (lines.length > 1) { line += lines.length - 1; column = Array.from(lines.at(-1)).length + 1; }
    else column += Array.from(text).length;
  };
  for (const match of marked.matchAll(pattern)) {
    append(marked.slice(cursor, match.index));
    const id = Number(match[2]);
    if (match[1] === '+') stack.push({ id, generated: { line, column } });
    else {
      const index = stack.findLastIndex((item) => item.id === id);
      if (index >= 0) {
        const start = stack.splice(index, 1)[0];
        mappings.push({ generated: start.generated, generatedEnd: { line, column }, source: session.origins[id] });
      }
    }
    cursor = match.index + match[0].length;
  }
  append(marked.slice(cursor));
  return { code, sourceMap: { version: 1, generatedFile, mappings } };
}

export function originalLocation(sourceMap, line, column = 1) {
  const point = { line, column };
  const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
  const matches = (sourceMap?.mappings || []).filter((m) => before(m.generated, point) && before(point, m.generatedEnd));
  matches.sort((a, b) => (a.generatedEnd.line - a.generated.line) - (b.generatedEnd.line - b.generated.line) || (a.generatedEnd.column - a.generated.column) - (b.generatedEnd.column - b.generated.column));
  return matches[0]?.source || null;
}

/** Accept rustc JSON messages or the human-readable stderr from Rust Playground/Cargo. */
export function mapRustDiagnostics(input, sourceMaps) {
  const maps = sourceMaps?.version ? { [sourceMaps.generatedFile]: sourceMaps } : sourceMaps || {};
  const output = [];
  function add(message, severity, code, span) {
    const generatedFile = span.file_name?.replaceAll('\\', '/') || 'src/main.rs';
    const equivalent = ['main.rs', 'src/main.rs', '/playground/src/main.rs'].includes(generatedFile);
    const suffix = Object.entries(maps).filter(([name]) => generatedFile.endsWith('/' + name));
    const map = maps[generatedFile] || (suffix.length === 1 ? suffix[0][1] : null) || (equivalent && Object.keys(maps).length === 1 ? Object.values(maps)[0] : null);
    const source = originalLocation(map, span.line_start, span.column_start);
    output.push({ code: code || 'RUST_COMPILER', severity, category: 'rust', message, generated: { filename: generatedFile, line: span.line_start, column: span.column_start }, ...(source || {}), mapped: Boolean(source) });
  }
  let message = 'Rust 編譯訊息', severity = 'error', code = 'RUST_COMPILER';
  for (const line of String(input).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    try {
      const json = JSON.parse(line);
      const diagnostic = json.reason === 'compiler-message' ? json.message : json;
      if (diagnostic?.spans) {
        for (const span of diagnostic.spans.filter((s) => s.is_primary)) add(diagnostic.message, diagnostic.level === 'warning' ? 'warning' : 'error', diagnostic.code?.code, span);
        continue;
      }
    } catch { /* Human-readable compiler output. */ }
    const heading = line.match(/^(error|warning)(?:\[([^\]]+)\])?:\s*(.+)/);
    if (heading) { severity = heading[1]; code = heading[2] || 'RUST_COMPILER'; message = heading[3]; }
    const span = line.match(/^\s*(?:-->|:::)\s+(.+):(\d+):(\d+)\s*$/);
    if (span) add(message, severity, code, { file_name: span[1], line_start: Number(span[2]), column_start: Number(span[3]) });
  }
  return output;
}
