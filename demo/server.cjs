// Минимальный статический сервер для демо.
// ES-модули нельзя загрузить по file:// — браузер блокирует такой запрос CORS-политикой,
// поэтому демо нужно открывать по http.
// Запуск: npm run demo (или node demo/server.cjs), затем http://localhost:8080/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
};

const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const relative = decodeURIComponent(pathname === '/' ? '/demo/index.html' : pathname);

    // path.resolve нормализует '..' — запрос не может выйти за пределы проекта
    const filePath = path.resolve(ROOT, '.' + relative);
    if (!filePath.startsWith(ROOT + path.sep)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('403 Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            const status = error.code === 'ENOENT' ? 404 : 500;
            response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(`${status} ${error.code}: ${relative}`);
            return;
        }

        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        response.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`demo: http://localhost:${PORT}/`);
});
