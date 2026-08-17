/* ============================================================
   jmf admin panel — Vercel Serverless Function
   يحوّل Express app إلى serverless function لـ Vercel
   ============================================================ */

'use strict';

const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* ---------------------------- GitHub Config ---------------------------- */

const GITHUB_REPO_URL = 'https://github.com/lootb8890-hue/OmniRoute-api-.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

function getGithubConfig() {
  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
  };
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

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jmf-coder-admin',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = 'token ' + GITHUB_TOKEN;

  const url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents' + filePath;
  return httpRequest(url, { method: opts.method || 'GET', headers, body: opts.body });
}

async function getGitHubFileSHA(filePath) {
  try {
    const result = await githubRequest(filePath, { method: 'GET' });
    if (result.statusCode === 200) {
      return JSON.parse(result.body).sha || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function pushToGitHub(filePath, content) {
  const sha = await getGitHubFileSHA(filePath);
  const body = {
    message: 'تحديث — jmf coder admin',
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;

  const result = await githubRequest(filePath, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (result.statusCode >= 200 && result.statusCode < 300) return { ok: true };
  throw new Error('GitHub API error (' + result.statusCode + ')');
}

async function readFromGitHub(filePath) {
  const cfg = getGithubConfig();
  if (!cfg) return null;
  const rawUrl = 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/main' + filePath;
  const result = await httpGet(rawUrl);
  if (result.statusCode === 200) return JSON.parse(result.body);
  return null;
}

/* ---------------------------- مسارات API — النماذج ---------------------------- */

app.get('/api/models', async (_req, res) => {
  try {
    const models = await readFromGitHub('/admin-models.json');
    res.json(models || []);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/models', async (req, res) => {
  try {
    const models = (await readFromGitHub('/admin-models.json')) || [];
    const model = req.body;
    if (!model || !model.id || !model.name || !model.provider) {
      return res.status(400).json({ error: 'الحقول المطلوبة: id, name, provider' });
    }
    if (models.find(m => m.id === model.id)) {
      return res.status(409).json({ error: 'النموذج موجود بالفعل' });
    }
    model.createdAt = Date.now();
    model.updatedAt = Date.now();
    model.active = model.active !== false;
    models.push(model);
    await pushToGitHub('/admin-models.json', models);
    res.json({ ok: true, model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/models/:id', async (req, res) => {
  try {
    const models = (await readFromGitHub('/admin-models.json')) || [];
    const idx = models.findIndex(m => m.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'النموذج غير موجود' });
    models[idx] = { ...models[idx], ...req.body, id: req.params.id, updatedAt: Date.now() };
    await pushToGitHub('/admin-models.json', models);
    res.json({ ok: true, model: models[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/models/:id', async (req, res) => {
  try {
    let models = (await readFromGitHub('/admin-models.json')) || [];
    models = models.filter(m => m.id !== req.params.id);
    await pushToGitHub('/admin-models.json', models);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — التوكنات ---------------------------- */

app.get('/api/tokens', async (_req, res) => {
  try {
    const tokens = (await readFromGitHub('/admin-tokens.json')) || [];
    const safe = tokens.map(t => ({
      ...t,
      key: t.key ? t.key.slice(0, 8) + '••••••••' + t.key.slice(-4) : '***',
    }));
    res.json(safe);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/tokens', async (req, res) => {
  try {
    const tokens = (await readFromGitHub('/admin-tokens.json')) || [];
    const { provider, key, baseUrl } = req.body;
    if (!provider || !key) return res.status(400).json({ error: 'الحقول المطلوبة: provider, key' });
    const idx = tokens.findIndex(t => t.provider === provider);
    if (idx >= 0) {
      tokens[idx] = { ...tokens[idx], key, baseUrl: baseUrl || tokens[idx].baseUrl, updatedAt: Date.now() };
    } else {
      tokens.push({ provider, key, baseUrl: baseUrl || null, createdAt: Date.now() });
    }
    await pushToGitHub('/admin-tokens.json', tokens);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tokens/:provider', async (req, res) => {
  try {
    let tokens = (await readFromGitHub('/admin-tokens.json')) || [];
    tokens = tokens.filter(t => t.provider !== req.params.provider);
    await pushToGitHub('/admin-tokens.json', tokens);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — المزامنة ---------------------------- */

app.post('/api/sync/push', async (_req, res) => {
  try {
    const models = (await readFromGitHub('/admin-models.json')) || [];
    await pushToGitHub('/admin-models.json', models);
    res.json({ ok: true, message: 'تم الرفع بنجاح' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/pull', async (_req, res) => {
  try {
    const models = await readFromGitHub('/admin-models.json');
    if (!models) throw new Error('الملف غير موجود على GitHub');
    res.json({ ok: true, models });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/test', async (_req, res) => {
  try {
    const models = await readFromGitHub('/admin-models.json');
    if (models && Array.isArray(models)) {
      res.json({ ok: true, modelCount: models.length });
    } else {
      throw new Error('الملف غير موجود');
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — معلومات ---------------------------- */

app.get('/api/info', async (_req, res) => {
  try {
    const models = (await readFromGitHub('/admin-models.json')) || [];
    res.json({
      version: '1.0.0',
      modelCount: models.length,
      platform: 'vercel',
      githubConfigured: true,
    });
  } catch (e) {
    res.json({ version: '1.0.0', modelCount: 0, platform: 'vercel', githubConfigured: true });
  }
});

/* ---------------------------- API Routes ---------------------------- */

module.exports = app;
