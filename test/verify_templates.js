import { transpile } from '../src/index.js';
import { loadTemplates } from './templates.js';
const templates = loadTemplates();

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
