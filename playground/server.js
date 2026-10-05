/**
 * Lightweight Zero-dependency Playground Dev Server
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  transpile,
  transpileMultiModules,
  generateRustProject,
  validateJavaScript,
  validateProject,
  transpileMultiModulesWithSourceMap,
  generateRustProjectWithSourceMap,
  mapRustDiagnostics,
} from '../src/index.js';
import { prepareComparison } from '../src/comparison.js';
import { diagnosticsFromError } from '../src/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

export function createPlaygroundServer() {
  return http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Transpile API (Supports both single code and multi-module files)
    if (
      req.method === 'POST' &&
      ['/api/transpile', '/api/validate', '/api/prepare-comparison', '/api/map-diagnostics'].includes(req.url)
    ) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            throw new TypeError('請提供 code 或 files。');
          if (req.url === '/api/map-diagnostics') {
            if (typeof payload.stderr !== 'string' || !payload.sourceMaps || typeof payload.sourceMaps !== 'object') throw new TypeError('請提供 stderr 與 sourceMaps。');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ diagnostics: mapRustDiagnostics(payload.stderr, payload.sourceMaps) }));
            return;
          }
          if (
            payload.files !== undefined &&
            (!payload.files ||
              typeof payload.files !== 'object' ||
              Array.isArray(payload.files) ||
              Object.values(payload.files).some(
                (source) => typeof source !== 'string',
              ))
          )
            throw new TypeError('files 必須是檔名對應程式碼字串的物件。');
          if (payload.files === undefined && typeof payload.code !== 'string')
            throw new TypeError('code 必須是字串。');
          if (req.url === '/api/prepare-comparison') {
            const comparison = prepareComparison(payload.files || { [payload.filename || 'main.js']: payload.code }, payload);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(comparison));
            return;
          }
          const validation = payload.files
            ? validateProject(payload.files)
            : validateJavaScript(payload.code, {
                filename: payload.filename || 'main.js',
              });
          if (!validation.valid || req.url === '/api/validate') {
            res.writeHead(validation.valid ? 200 : 422, {
              'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(
              JSON.stringify({
                ...validation,
                phase: 'validation',
                ...(!validation.valid
                  ? { error: 'JavaScript 檢查未通過，尚未產生 Rust。' }
                  : {}),
              }),
            );
            return;
          }
          let rust = '';
          let projectFiles = {};
          const sourceFiles = payload.files || { [payload.filename || 'main.js']: payload.code };
          const merged = transpileMultiModulesWithSourceMap(sourceFiles);
          const project = generateRustProjectWithSourceMap(sourceFiles);
          rust = merged.code;
          projectFiles = project.projectFiles;
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              rust,
              projectFiles,
              diagnostics: validation.diagnostics,
              valid: true,
              sourceMap: merged.sourceMap,
              sourceMaps: project.sourceMaps,
            }),
          );
        } catch (err) {
          res.writeHead(
            err instanceof SyntaxError || err instanceof TypeError ? 400 : 422,
            { 'Content-Type': 'application/json; charset=utf-8' },
          );
          res.end(
            JSON.stringify({
              error: err.message,
              valid: false,
              phase: 'validation',
              diagnostics: diagnosticsFromError(err),
            }),
          );
        }
      });
      return;
    }

    // 2. Proxy Rust Playground API
    if (req.method === 'POST' && req.url === '/api/run-rust') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const rustRes = await fetch('https://play.rust-lang.org/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await rustRes.json();
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify(data));
        } catch (err) {
          res.writeHead(500, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 3. Serve Frontend HTML
    if (req.method === 'GET' && ['/history.js', '/comparison-values.js', '/compare-worker.js'].includes(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, req.url.slice(1)), 'utf8'));
      return;
    }
    if (
      req.method === 'GET' &&
      (req.url === '/' || req.url === '/index.html')
    ) {
      const htmlPath = path.join(__dirname, 'index.html');
      fs.readFile(htmlPath, 'utf-8', (err, content) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading playground HTML');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename)
  createPlaygroundServer().listen(PORT, '127.0.0.1', () => {
    console.log(`\n🦀 js-to-rust Playground is running!`);
    console.log(`👉 Open http://localhost:${PORT} in your browser\n`);
  });
