import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const PORT = process.env.PORT || 3456;
const __filename = fileURLToPath(import.meta.url);
const DIR = dirname(__filename);

const SUPABASE_HOST = 'jznienvopdejqvpalgbl.supabase.co';
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE || '';

function supabaseCall(method, path, body, serviceKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req2 = httpsRequest({
      hostname: SUPABASE_HOST, port: 443,
      path: '/rest/v1/' + path,
      method,
      headers,
    }, (res2) => {
      let data = '';
      res2.on('data', c => { data += c; });
      res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
    });
    req2.on('error', reject);
    req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Supabase timeout')); });
    if (bodyStr) req2.write(bodyStr);
    req2.end();
  });
}

function validateAdminPassphrase(passphrase) {
  return ADMIN_PASSPHRASE && passphrase === ADMIN_PASSPHRASE;
}

// Try to get gh CLI token for GitHub Models access
function getGhToken() {
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// Copilot OAuth token (from device flow) and cached Copilot API token
let copilotOAuthToken = process.env.COPILOT_OAUTH_TOKEN || '';
let copilotApiToken = null;
let copilotApiEndpoint = null;
let copilotTokenExpiry = 0;

async function getCopilotToken() {
  // Return cached token if still valid (with 60s buffer)
  if (copilotApiToken && Date.now() / 1000 < copilotTokenExpiry - 60) {
    return { token: copilotApiToken, endpoint: copilotApiEndpoint };
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.github.com', port: 443,
      path: '/copilot_internal/v2/token',
      method: 'GET',
      headers: {
        'authorization': `token ${copilotOAuthToken}`,
        'user-agent': 'GithubCopilot/1.155.0',
        'accept': 'application/json',
        'editor-version': 'vscode/1.96.2',
        'editor-plugin-version': 'copilot/1.155.0',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Copilot token exchange failed (${res.statusCode}): ${data.slice(0, 200)}`));
          return;
        }
        const json = JSON.parse(data);
        copilotApiToken = json.token;
        copilotApiEndpoint = json.endpoints?.api || 'https://api.business.githubcopilot.com';
        copilotTokenExpiry = json.expires_at || (Date.now() / 1000 + 1800);
        resolve({ token: copilotApiToken, endpoint: copilotApiEndpoint });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout getting Copilot token')); });
    req.end();
  });
}

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
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'X-GitHub-Api-Version': '2025-02-01',
    }),
  },
  copilot: {
    hostname: 'api.githubcopilot.com',
    path: '/chat/completions',
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Editor-Version': 'vscode/1.96.0',
      'Copilot-Integration-Id': 'vscode-chat',
    }),
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

  // Get token from gh CLI
  if (req.method === 'GET' && req.url === '/api/gh-token') {
    const token = getGhToken();
    if (token) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: token.slice(0, 4) + '...' + token.slice(-4), hasToken: true }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hasToken: false, message: 'gh CLI not found or not logged in. Run: gh auth login' }));
    }
    return;
  }

  // Use Copilot API (auto-auth via OAuth token exchange)
  if (req.method === 'POST' && req.url === '/api/translate-copilot') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { payload } = JSON.parse(body);

    try {
      const { token, endpoint } = await getCopilotToken();
      const apiHost = new URL(endpoint).hostname;

      const result = await new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const req2 = httpsRequest({
          hostname: apiHost, port: 443,
          path: '/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'GitHubCopilotChat/0.25.0',
            'Editor-Version': 'vscode/1.96.2',
            'Copilot-Integration-Id': 'vscode-chat',
          },
        }, (res2) => {
          let data = '';
          res2.on('data', c => { data += c; });
          res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
        });
        req2.on('error', e => reject(new Error(`Copilot API error: ${e.message}`)));
        req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('Copilot API timeout')); });
        req2.write(bodyStr);
        req2.end();
      });

      if (result.status !== 200) {
        console.error(`Copilot API returned ${result.status}:`, result.body.slice(0, 300));
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      console.error('Copilot proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // Use gh CLI token for GitHub Models (auto-auth)
  if (req.method === 'POST' && req.url === '/api/translate-auto') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { payload } = JSON.parse(body);

    const token = getGhToken();
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'gh CLI not logged in. Run: gh auth login' } }));
      return;
    }

    try {
      const result = await proxyRequest('github', token, payload);
      if (result.status !== 200) {
        console.error(`GitHub Models (auto) returned ${result.status}:`, result.body.slice(0, 300));
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      console.error('Auto proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // API proxy endpoint - test token + find working models
  if (req.method === 'POST' && req.url === '/api/test-models') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { key } = JSON.parse(body);

    // Get catalog
    const catalogResult = await new Promise((resolve, reject) => {
      const req2 = httpsRequest({
        hostname: 'models.github.ai',
        port: 443,
        path: '/catalog/models',
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, (res2) => {
        let data = '';
        res2.on('data', c => { data += c; });
        res2.on('end', () => resolve({ status: res2.statusCode, body: data }));
      });
      req2.on('error', e => reject(e));
      req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Timeout')); });
      req2.end();
    });

    if (catalogResult.status !== 200) {
      res.writeHead(catalogResult.status, { 'Content-Type': 'application/json' });
      res.end(catalogResult.body);
      return;
    }

    // Now test actual access with a tiny request to a model
    const models = JSON.parse(catalogResult.body);
    const chatModels = models.filter(m => m.task === 'chat-completion' || !m.task).map(m => m.id).filter(Boolean);

    // Test a few models to find which ones work
    const testModel = async (modelId) => {
      const testBody = JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      });
      return new Promise((resolve) => {
        const req2 = httpsRequest({
          hostname: 'models.github.ai',
          port: 443,
          path: '/inference/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(testBody),
            'Authorization': `Bearer ${key}`,
          },
        }, (res2) => {
          let data = '';
          res2.on('data', c => { data += c; });
          res2.on('end', () => resolve({ model: modelId, status: res2.statusCode, body: data }));
        });
        req2.on('error', () => resolve({ model: modelId, status: 0, body: 'connection error' }));
        req2.setTimeout(10000, () => { req2.destroy(); resolve({ model: modelId, status: 0, body: 'timeout' }); });
        req2.write(testBody);
        req2.end();
      });
    };

    // Test a small subset of popular models in parallel
    const modelsToTest = chatModels.slice(0, 8);
    console.log('Testing access to models:', modelsToTest.join(', '));
    const results = await Promise.all(modelsToTest.map(testModel));

    const accessible = results.filter(r => r.status === 200).map(r => r.model);
    const denied = results.filter(r => r.status !== 200);
    if (denied.length > 0) {
      console.log('Denied models:', denied.map(r => `${r.model}(${r.status})`).join(', '));
    }
    console.log('Accessible models:', accessible.length > 0 ? accessible.join(', ') : 'NONE');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ all: chatModels, accessible, denied: denied.map(r => ({ model: r.model, status: r.status })) }));
    return;
  }

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
      if (result.status !== 200) {
        console.error(`API returned ${result.status}:`, result.body.slice(0, 300));
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      console.error('Proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  // POST /api/suggest — public: submit a suggestion (no passphrase required)
  if (req.method === 'POST' && req.url === '/api/suggest') {
    const svcKey = process.env.SUPABASE_SERVICE_KEY;
    if (!svcKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not configured for suggestions (missing SUPABASE_SERVICE_KEY)' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    const { english, mienh, notes } = parsed;
    if (!english?.trim() || !mienh?.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'english and mienh are required' }));
      return;
    }
    try {
      const result = await supabaseCall('POST', 'corrections', {
        english: english.toLowerCase().trim(),
        mienh: mienh.trim(),
        notes: notes?.trim() || null,
        type: 'suggested',
      }, svcKey);
      res.writeHead(result.status >= 200 && result.status < 300 ? 201 : result.status, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/admin/suggestions — list pending suggestions (passphrase required)
  if (req.method === 'POST' && req.url === '/api/admin/suggestions') {
    const svcKey = process.env.SUPABASE_SERVICE_KEY;
    if (!ADMIN_PASSPHRASE || !svcKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin not configured (set ADMIN_PASSPHRASE and SUPABASE_SERVICE_KEY env vars)' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    if (!validateAdminPassphrase(parsed.passphrase)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid passphrase' }));
      return;
    }
    try {
      const result = await supabaseCall('GET', 'corrections?type=eq.suggested&select=*&order=created_at.asc', null, svcKey);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/admin/approve — approve a suggestion (passphrase required)
  if (req.method === 'POST' && req.url === '/api/admin/approve') {
    const svcKey = process.env.SUPABASE_SERVICE_KEY;
    if (!ADMIN_PASSPHRASE || !svcKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin not configured' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    if (!validateAdminPassphrase(parsed.passphrase)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid passphrase' }));
      return;
    }
    const { id, isNew } = parsed;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id is required' }));
      return;
    }
    try {
      const result = await supabaseCall('PATCH', `corrections?id=eq.${id}`, {
        type: isNew ? 'added' : 'edited',
      }, svcKey);
      res.writeHead(result.status >= 200 && result.status < 300 ? 200 : result.status, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/admin/reject — reject (delete) a suggestion (passphrase required)
  if (req.method === 'POST' && req.url === '/api/admin/reject') {
    const svcKey = process.env.SUPABASE_SERVICE_KEY;
    if (!ADMIN_PASSPHRASE || !svcKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin not configured' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    if (!validateAdminPassphrase(parsed.passphrase)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid passphrase' }));
      return;
    }
    const { id } = parsed;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id is required' }));
      return;
    }
    try {
      const result = await supabaseCall('DELETE', `corrections?id=eq.${id}`, null, svcKey);
      res.writeHead(result.status >= 200 && result.status < 300 ? 200 : result.status, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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
