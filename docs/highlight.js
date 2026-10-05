// Display-only lexical highlighting. Source is always inserted as text, never HTML.
(() => {
  const words = (text) => new Set(text.split(' '));
  const keywords = {
    javascript: words('async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of private protected public return static super switch this throw try typeof unsafe var void while with yield type as declare readonly abstract'),
    rust: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
  };
  const literals = words('true false null undefined NaN Infinity None Some Ok Err');
  const types = words('number boolean string any unknown never void bool char str String Vec Option Result Box Arc Mutex HashMap HashSet Sender Receiver Promise i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64');
  const identifier = /^[A-Za-z_$][\w$]*$/;
  // Rust lifetimes are intentionally recognized separately from quoted characters.
  const tokens = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\])*`|'[A-Za-z_]\w*|(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)(?:[iu](?:8|16|32|64|128|size)|f(?:32|64)|n)?|[A-Za-z_$][\w$]*|[\s\S]/gy;

  function languageForFile(file) {
    if (/\.rs$/i.test(file)) return 'rust';
    if (/\.toml$/i.test(file)) return 'toml';
    if (/\.[cm]?[jt]sx?$/i.test(file)) return 'javascript';
    return 'text';
  }

  function render(target, source, language = 'text') {
    const fragment = document.createDocumentFragment();
    let plain = '';
    let position = 0;
    const flush = () => {
      if (plain) fragment.append(document.createTextNode(plain));
      plain = '';
    };
    while (position < source.length) {
      let value;
      let kind;
      if (language === 'rust') {
        // Raw strings can contain quotes and any number of matching # delimiters.
        const raw = /^(?:br|r)(#*)"/.exec(source.slice(position));
        if (raw) {
          const closing = `"${raw[1]}`;
          const end = source.indexOf(closing, position + raw[0].length);
          value = source.slice(position, end < 0 ? source.length : end + closing.length);
          kind = 'string';
        } else if (/^'[A-Za-z_]\w*(?![\w'])/.test(source.slice(position))) {
          value = /^'[A-Za-z_]\w*/.exec(source.slice(position))[0];
          kind = 'type';
        } else if (source.startsWith('/*', position)) {
          let end = position + 2;
          let depth = 1;
          while (end < source.length && depth) {
            if (source.startsWith('/*', end)) { depth++; end += 2; }
            else if (source.startsWith('*/', end)) { depth--; end += 2; }
            else end++;
          }
          value = source.slice(position, end);
          kind = 'comment';
        }
      }
      if (!value) {
        tokens.lastIndex = position;
        value = tokens.exec(source)[0];
        if (language === 'text') kind = undefined;
        else if (value.startsWith('//') || value.startsWith('/*')) kind = 'comment';
        else if (/^["'`]/.test(value)) kind = /^'\w+$/.test(value) ? 'type' : 'string';
        else if (/^\d/.test(value)) kind = 'number';
        else if (keywords[language]?.has(value)) kind = 'keyword';
        else if (literals.has(value)) kind = 'literal';
        else if (types.has(value)) kind = 'type';
        else if (identifier.test(value) && /^\s*!?\s*\(/.test(source.slice(position + value.length))) kind = 'function';
        else if (language === 'toml' && identifier.test(value) && /^\s*=/.test(source.slice(position + value.length))) kind = 'property';
      }
      if (language === 'toml' && value === '#') {
        const end = source.indexOf('\n', position);
        value = source.slice(position, end < 0 ? source.length : end);
        kind = 'comment';
      }
      if (kind) {
        flush();
        const span = document.createElement('span');
        span.className = `syntax-${kind}`;
        span.textContent = value;
        fragment.append(span);
      } else plain += value;
      position += value.length;
    }
    flush();
    target.replaceChildren(fragment);
    target.dataset.language = language;
  }
  window.JS2RUST_HIGHLIGHT = { render, languageForFile };
})();
