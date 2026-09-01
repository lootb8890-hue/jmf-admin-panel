/* ============================================================
   jmf admin panel — Netlify Function
   يعمل كـ serverless function على Netlify (مجاني)
   ============================================================ */

'use strict';

const https = require('https');
const http = require('http');

/* ---------------------------- GitHub Config ---------------------------- */

const GITHUB_REPO_URL = 'https://github.com/lootb8890-hue/OmniRoute-api-.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

function getGithubConfig() {
  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/* ---------------------------- مساعدات الشبكة ---------------------------- */

function httpRequest(url, opts) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (d) => body += d.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      let body = '';
      res.on('data', (d) => body += d.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

/* ---------------------------- GitHub API ---------------------------- */

async function githubRequest(filePath, opts) {
  const cfg = getGithubConfig();
  if (!cfg) throw new Error('GitHub config invalid');
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'jmf-coder-admin' };
  if (GITHUB_TOKEN) headers['Authorization'] = 'token ' + GITHUB_TOKEN;
  const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents' + filePath;
  return httpRequest(url, { method: opts.method || 'GET', headers, body: opts.body });
}

async function getGitHubFileSHA(filePath) {
  try {
    const r = await githubRequest(filePath, { method: 'GET' });
    if (r.statusCode === 200) return JSON.parse(r.body).sha || null;
  } catch (e) { /* ignore */ }
  return null;
}

async function pushToGitHub(filePath, content) {
  const sha = await getGitHubFileSHA(filePath);
  const body = { message: 'تحديث — jmf coder admin', content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64') };
  if (sha) body.sha = sha;
  const r = await githubRequest(filePath, { method: 'PUT', body: JSON.stringify(body) });
  if (r.statusCode >= 200 && r.statusCode < 300) return { ok: true };
  throw new Error('GitHub error (' + r.statusCode + ')');
}

async function readFromGitHub(filePath) {
  const cfg = getGithubConfig();
  if (!cfg) return null;
  const rawUrl = 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/main' + filePath;
  const r = await httpGet(rawUrl);
  if (r.statusCode === 200) return JSON.parse(r.body);
  return null;
}

/* ---------------------------- Netlify Handler ---------------------------- */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path.replace(/^\/.netlify\/functions\/api/, '') || '/';
  const method = event.httpMethod;

  try {
    // GET /api/models
    if (method === 'GET' && path === '/models') {
      const models = (await readFromGitHub('/admin-models.json')) || [];
      return { statusCode: 200, headers, body: JSON.stringify(models) };
    }

    // POST /api/models
    if (method === 'POST' && path === '/models') {
      const body = JSON.parse(event.body);
      const models = (await readFromGitHub('/admin-models.json')) || [];
      if (!body.id || !body.name || !body.provider) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'الحقول المطلوبة: id, name, provider' }) };
      }
      if (models.find(m => m.id === body.id)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'النموذج موجود بالفعل' }) };
      }
      body.createdAt = Date.now();
      body.updatedAt = Date.now();
      body.active = body.active !== false;
      models.push(body);
      await pushToGitHub('/admin-models.json', models);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, model: body }) };
    }

    // PUT /api/models/:id
    if (method === 'PUT' && path.startsWith('/models/')) {
      const id = decodeURIComponent(path.split('/models/')[1]);
      const body = JSON.parse(event.body);
      const models = (await readFromGitHub('/admin-models.json')) || [];
      const idx = models.findIndex(m => m.id === id);
      if (idx < 0) return { statusCode: 404, headers, body: JSON.stringify({ error: 'غير موجود' }) };
      models[idx] = { ...models[idx], ...body, id, updatedAt: Date.now() };
      await pushToGitHub('/admin-models.json', models);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, model: models[idx] }) };
    }

    // DELETE /api/models/:id
    if (method === 'DELETE' && path.startsWith('/models/')) {
      const id = decodeURIComponent(path.split('/models/')[1]);
      let models = (await readFromGitHub('/admin-models.json')) || [];
      models = models.filter(m => m.id !== id);
      await pushToGitHub('/admin-models.json', models);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // GET /api/tokens
    if (method === 'GET' && path === '/tokens') {
      const tokens = (await readFromGitHub('/admin-tokens.json')) || [];
      const safe = tokens.map(t => ({ ...t, key: t.key ? t.key.slice(0, 8) + '••••••••' + t.key.slice(-4) : '***' }));
      return { statusCode: 200, headers, body: JSON.stringify(safe) };
    }

    // POST /api/tokens
    if (method === 'POST' && path === '/tokens') {
      const body = JSON.parse(event.body);
      const tokens = (await readFromGitHub('/admin-tokens.json')) || [];
      if (!body.provider || !body.key) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'الحقول المطلوبة: provider, key' }) };
      }
      const idx = tokens.findIndex(t => t.provider === body.provider);
      if (idx >= 0) {
        tokens[idx] = { ...tokens[idx], key: body.key, baseUrl: body.baseUrl || tokens[idx].baseUrl, updatedAt: Date.now() };
      } else {
        tokens.push({ provider: body.provider, key: body.key, baseUrl: body.baseUrl || null, createdAt: Date.now() });
      }
      await pushToGitHub('/admin-tokens.json', tokens);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // DELETE /api/tokens/:provider
    if (method === 'DELETE' && path.startsWith('/tokens/')) {
      const provider = decodeURIComponent(path.split('/tokens/')[1]);
      let tokens = (await readFromGitHub('/admin-tokens.json')) || [];
      tokens = tokens.filter(t => t.provider !== provider);
      await pushToGitHub('/admin-tokens.json', tokens);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // POST /api/sync/test
    if (method === 'POST' && path === '/sync/test') {
      const models = await readFromGitHub('/admin-models.json');
      if (models && Array.isArray(models)) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, modelCount: models.length }) };
      }
      throw new Error('الملف غير موجود');
    }

    // POST /api/sync/pull
    if (method === 'POST' && path === '/sync/pull') {
      const models = await readFromGitHub('/admin-models.json');
      if (!models) throw new Error('الملف غير موجود');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, models }) };
    }

    // POST /api/sync/push
    if (method === 'POST' && path === '/sync/push') {
      const models = (await readFromGitHub('/admin-models.json')) || [];
      await pushToGitHub('/admin-models.json', models);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, message: 'تم الرفع بنجاح' }) };
    }

    // GET /api/info
    if (method === 'GET' && path === '/info') {
      const models = (await readFromGitHub('/admin-models.json')) || [];
      return { statusCode: 200, headers, body: JSON.stringify({ version: '1.0.0', modelCount: models.length, platform: 'netlify' }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
