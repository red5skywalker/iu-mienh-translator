import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = process.env.PORT || 3456;
const DIR = import.meta.dirname;

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
    url: 'https://models.inference.ai.github.com/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
  },
};

const server = createServer(async (req, res) => {
  // CORS headers for all responses
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

    try {
      const { provider, key, payload } = JSON.parse(body);
      const config = PROVIDERS[provider];
      if (!config) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unknown provider' }));
      }

      const resp = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.authHeader(key),
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.text();
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Could not reach ${provider} API: ${err.message}` } }));
    }
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url;
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
