const fs = require('fs');
const http = require('http');
const output = process.argv[2];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    fs.writeFileSync(output, JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    setTimeout(() => server.close(() => process.exit(0)), 500);
  });
});
server.listen(3999, '0.0.0.0');
