/* ============================================================
   jmf admin panel — خادم مستقل لإدارة نماذج الذكاء الاصطناعي
   يعمل بشكل منفصل عن تطبيق Electron
   يُشغّل بـ: npm start (من مجلد admin-panel)
   يُفتح من المتصفّح على: http://localhost:3456
   ============================================================ */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');

const PORT = process.env.ADMIN_PORT || 3456;
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------- مسارات البيانات ---------------------------- */

function dataDir() {
  const d = path.join(__dirname, 'data');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function modelsFilePath() {
  return path.join(dataDir(), 'admin-models.json');
}

function tokensFilePath() {
  return path.join(dataDir(), 'admin-tokens.json');
}

function settingsFilePath() {
  return path.join(dataDir(), 'admin-settings.json');
}

function readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/* ---------------------------- مساعدات GitHub API ---------------------------- */

const GITHUB_REPO_URL = 'https://github.com/lootb8890-hue/OmniRoute-api-.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

async function githubRequest(urlPath, opts) {
  // استخراج owner/repo من الرابط الثابت
  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error('رابط GitHub غير صالح');

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jmf-coder-admin',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = 'token ' + GITHUB_TOKEN;

  const fullPath = '/repos/' + owner + '/' + repo + '/contents' + urlPath;

  return httpRequest('https://api.github.com' + fullPath, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
  });
}

async function getGitHubFileSHA(filePath) {
  try {
    const result = await githubRequest(filePath, { method: 'GET' });
    if (result.statusCode === 200) {
      const data = JSON.parse(result.body);
      return data.sha || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function pushToGitHub(filePath, content) {
  const sha = await getGitHubFileSHA(filePath);
  const body = {
    message: 'تحديث النماذج — jmf coder admin',
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;

  const result = await githubRequest(filePath, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (result.statusCode >= 200 && result.statusCode < 300) {
    return { ok: true };
  }
  throw new Error('فشل الرفع إلى GitHub (' + result.statusCode + '): ' + result.body.slice(0, 200));
}

/* ---------------------------- مسارات API — الإعدادات ---------------------------- */

app.get('/api/settings', (_req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  // إخفاء التوكن في الاستجابة
  const safe = { ...settings };
  if (safe.githubToken) safe.githubToken = safe.githubToken.slice(0, 8) + '••••••••';
  res.json(safe);
});

app.post('/api/settings', (req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  Object.assign(settings, req.body);
  writeJson(settingsFilePath(), settings);
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — النماذج ---------------------------- */

app.get('/api/models', (_req, res) => {
  const models = readJson(modelsFilePath()) || [];
  res.json(models);
});

app.post('/api/models', async (req, res) => {
  const models = readJson(modelsFilePath()) || [];
  const model = req.body;
  if (!model || !model.id || !model.name || !model.provider) {
    return res.status(400).json({ error: 'الحقول المطلوبة: id, name, provider' });
  }
  if (models.find(m => m.id === model.id)) {
    return res.status(409).json({ error: 'النموذج موجود بالفعل بنفس المعرّف' });
  }
  model.createdAt = Date.now();
  model.updatedAt = Date.now();
  model.active = model.active !== false;
  models.push(model);
  writeJson(modelsFilePath(), models);

  // رفع تلقائي إلى GitHub
  let synced = false;
  try {
    await pushToGitHub('/admin-models.json', models);
    synced = true;
    console.log('  ✓ تم رفع النموذج إلى GitHub');
  } catch (e) {
    console.log('  ✗ تعذر الرفع إلى GitHub:', e.message);
  }
  res.json({ ok: true, model, synced });
});

app.put('/api/models/:id', async (req, res) => {
  const models = readJson(modelsFilePath()) || [];
  const idx = models.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'النموذج غير موجود' });
  models[idx] = { ...models[idx], ...req.body, id: req.params.id, updatedAt: Date.now() };
  writeJson(modelsFilePath(), models);

  let synced = false;
  try {
    await pushToGitHub('/admin-models.json', models);
    synced = true;
    console.log('  ✓ تم تحديث النموذج على GitHub');
  } catch (e) {
    console.log('  ✗ تعذر التحديث على GitHub:', e.message);
  }
  res.json({ ok: true, model: models[idx], synced });
});

app.delete('/api/models/:id', async (req, res) => {
  let models = readJson(modelsFilePath()) || [];
  models = models.filter(m => m.id !== req.params.id);
  writeJson(modelsFilePath(), models);

  let synced = false;
  try {
    await pushToGitHub('/admin-models.json', models);
    synced = true;
    console.log('  ✓ تم حذف النموذج من GitHub');
  } catch (e) {
    console.log('  ✗ تعذر الحذف من GitHub:', e.message);
  }
  res.json({ ok: true, synced });
});

/* ---------------------------- مسارات API — رفع يدوي ---------------------------- */

app.post('/api/sync/push', async (_req, res) => {
  try {
    const models = readJson(modelsFilePath()) || [];
    await pushToGitHub('/admin-models.json', models);
    res.json({ ok: true, message: 'تم الرفع إلى GitHub بنجاح' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/pull', async (_req, res) => {
  try {
    // استخراج owner/repo من الرابط الثابت
    const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('رابط GitHub غير صالح');

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    const rawUrl = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/main/admin-models.json';
    const result = await httpGet(rawUrl);
    if (result.statusCode !== 200) throw new Error('الملف غير موجود على GitHub');

    const remoteModels = JSON.parse(result.body);
    writeJson(modelsFilePath(), remoteModels);
    res.json({ ok: true, models: remoteModels });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/test', async (_req, res) => {
  try {
    // استخراج owner/repo من الرابط الثابت
    const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('رابط GitHub غير صالح');

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    const rawUrl = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/main/admin-models.json';
    const result = await httpGet(rawUrl);
    if (result.statusCode === 200) {
      const models = JSON.parse(result.body);
      res.json({ ok: true, modelCount: Array.isArray(models) ? models.length : 0 });
    } else {
      throw new Error('الملف غير موجود — تأكد من أن المستودع يحتوي على admin-models.json');
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — التوكنات ---------------------------- */

app.get('/api/tokens', (_req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  const safe = tokens.map(t => ({
    ...t,
    key: t.key ? t.key.slice(0, 8) + '••••••••' + t.key.slice(-4) : '***',
  }));
  res.json(safe);
});

app.get('/api/tokens/raw', (_req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  res.json(tokens);
});

app.post('/api/tokens', (req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  const { provider, key, baseUrl } = req.body;
  if (!provider || !key) {
    return res.status(400).json({ error: 'الحقول المطلوبة: provider, key' });
  }
  const idx = tokens.findIndex(t => t.provider === provider);
  if (idx >= 0) {
    tokens[idx] = { ...tokens[idx], key, baseUrl: baseUrl || tokens[idx].baseUrl, updatedAt: Date.now() };
  } else {
    tokens.push({ provider, key, baseUrl: baseUrl || null, createdAt: Date.now() });
  }
  writeJson(tokensFilePath(), tokens);
  res.json({ ok: true });
});

app.delete('/api/tokens/:provider', (req, res) => {
  let tokens = readJson(tokensFilePath()) || [];
  tokens = tokens.filter(t => t.provider !== req.params.provider);
  writeJson(tokensFilePath(), tokens);
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — معلومات ---------------------------- */

app.get('/api/info', (_req, res) => {
  const models = readJson(modelsFilePath()) || [];
  const settings = readJson(settingsFilePath()) || {};
  res.json({
    version: '1.0.0',
    modelCount: models.length,
    port: PORT,
    githubConfigured: !!settings.githubRepo,
  });
});

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

/* ---------------------------- تشغيل الخادم ---------------------------- */

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  jmf admin panel — لوحة التحكم الإدارية      ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║ http://localhost:${PORT}                       ║`);
  console.log('  ║  اضغط Ctrl+C لإيقاف الخادم                  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
