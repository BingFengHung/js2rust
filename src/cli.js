#!/usr/bin/env node

/**
 * Command-Line Interface for js-to-rust
 */

import fs from 'node:fs';
import path from 'node:path';
import { transpile } from './index.js';

function printHelp() {
  console.log(`
js-to-rust: Transpile JavaScript algorithms to Native Rust

Usage:
  node src/cli.js <file.js> [options]
  npm start -- <file.js> [options]

Options:
  -o, --output <file.rs>   Write output to a Rust file instead of stdout
  --default-type <type>    Default number type: i64 (default) or f64
  -h, --help               Show this help message

Example:
  node src/cli.js test/example.js -o output.rs
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const inputFile = args[0];
  let outputFile = null;
  let defaultNumberType = 'i64';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--default-type') {
      defaultNumberType = args[i + 1];
      i++;
    }
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found "${inputFile}"`);
    process.exit(1);
  }

  const jsSource = fs.readFileSync(inputFile, 'utf-8');

  try {
    const rustSource = transpile(jsSource, { defaultNumberType, filename: inputFile });

    if (outputFile) {
      fs.writeFileSync(outputFile, rustSource, 'utf-8');
      console.log(`[Success] Transpiled "${inputFile}" -> "${outputFile}"`);
    } else {
      console.log('// === Generated Rust Code ===\n');
      console.log(rustSource);
    }
  } catch (err) {
    console.error(`[Error] Transpilation failed: ${err.message}`);
    process.exit(1);
  }
}

main();

