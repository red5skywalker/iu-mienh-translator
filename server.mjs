import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const PORT = process.env.PORT || 3456;
const __filename = fileURLToPath(import.meta.url);
const DIR = dirname(__filename);

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PROVIDERS = {
  github: {
    hostname: 'models.github.ai',
    path: '/inference/v1/chat/completions',
    headers: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    headers: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  anthropic: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
  },
};

function proxyRequest(provider, key, payload) {
  return new Promise((resolve, reject) => {
    const config = PROVIDERS[provider];
    if (!config) return reject(new Error('Unknown provider: ' + provider));

    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: config.hostname,
      port: 443,
      path: config.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...config.headers(key),
      },
    };

    const req = httpsRequest(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Connection to ${config.hostname} failed: ${err.code || err.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Request to ${config.hostname} timed out after 30s`));
    });

    req.write(bodyStr);
    req.end();
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API proxy endpoint
  if (req.method === 'POST' && req.url === '/api/translate') {
    let body = '';
    for await (const chunk of req) body += chunk;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid JSON in request body' } }));
    }

    const { provider, key, payload } = parsed;

    try {
      const result = await proxyRequest(provider, key, payload);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      console.error('Proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // Static file serving
  let filePath = req.url.split('?')[0];
  filePath = filePath === '/' ? '/index.html' : filePath;
  filePath = join(DIR, filePath);

  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`\n  🌐 Iu Mienh Translator running at http://localhost:${PORT}\n`);
});
