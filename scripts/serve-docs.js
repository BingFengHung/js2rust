import http from 'node:http';
import fs from 'node:fs/promises';

const types = {
  '/index.html': 'text/html; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8',
  '/examples-data.js': 'text/javascript; charset=utf-8',
  '/templates-data.js': 'text/javascript; charset=utf-8',
  '/favicon.svg': 'image/svg+xml',
  '/favicon-32.png': 'image/png',
  '/apple-touch-icon.png': 'image/png',
  '/icon-512.png': 'image/png',
};
const port = Number(process.env.DOCS_PORT || 4173);
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/' ? '/index.html' : pathname;
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    if (!types[file]) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    const content = await fs.readFile(
      new URL(`../docs${file}`, import.meta.url),
    );
    response.writeHead(200, { 'Content-Type': types[file] });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500);
    response.end('Unable to load documentation');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`js2rust documentation: http://localhost:${port}`),
);
