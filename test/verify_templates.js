import { transpile } from '../src/index.js';
import fs from 'fs';

const html = fs.readFileSync('playground/index.html', 'utf8');
const match = html.match(/const TEMPLATES = ({[\s\S]*?^    };)/m);
if (!match) {
  console.error("Could not find TEMPLATES in playground/index.html");
  process.exit(1);
}

// Evaluate templates object safely
const getTemplates = new Function(`return ${match[1]};`);
const templates = getTemplates();

let count = 0;
for (const [key, tpl] of Object.entries(templates)) {
  for (const [filePath, content] of Object.entries(tpl.files)) {
    try {
      const rust = transpile(content);
      if (!rust) throw new Error("Empty rust output");
      console.log(`  ✓ Template ${key} [${filePath}] OK`);
      count++;
    } catch (err) {
      console.error(`  ✗ FAIL in template ${key} [${filePath}]:`, err);
      process.exit(1);
    }
  }
}

console.log(`\nAll ${count} template files transpiled to Rust successfully!\n`);
