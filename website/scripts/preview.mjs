import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const root = new URL('../', import.meta.url);
const types = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/main.js': ['main.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  const entry = types[new URL(request.url, 'http://localhost').pathname];
  if (!entry) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(new URL(entry[0], root));
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(500).end('Unable to read page');
  }
}).listen(port, '127.0.0.1', () => console.log(`Asterveil preview: http://127.0.0.1:${port}`));
