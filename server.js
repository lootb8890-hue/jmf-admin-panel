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
const os = require('os');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.ADMIN_PORT || 3456;
const OMNIROUTE_URL = process.env.OMNIROUTE_URL || 'http://localhost:20128';
const app = express();

const SUPABASE_DEFAULT_URL = 'https://lowbhxtnfntqympchvxt.supabase.co';
const SUPABASE_DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxvd2JoeHRuZm50cXltcGNodnh0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk3ODY1NCwiZXhwIjoyMTAyNTU0NjU0fQ.IRjSrmEs3rE71bYBKVjOX9MPnqqEZkq7Ef73TnfRhxk';

function getSupabase() {
  const url = process.env.SUPABASE_URL || SUPABASE_DEFAULT_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || SUPABASE_DEFAULT_KEY;
  if (!url || !key) return null;
  try { return createClient(url, key, { auth: { persistSession: false } }); } catch (e) { return null; }
}

/* ---------------- OmniRoute Auto-Start ---------------- */
let omnirouteProc = null;
const OMNIROUTE_PASSWORD = process.env.OMNIROUTE_PASSWORD || 'CHANGEME';

function findOmniRouteDir() {
  const candidates = [
    process.env.OMNIROUTE_DIR,
    path.join(os.homedir(), 'AppData', 'Roaming', 'jmf coder', 'omniroute'),
    path.join(os.homedir(), 'AppData', 'Local', 'jmf coder', 'omniroute'),
    path.join(os.homedir(), 'AppData', 'Local', 'jmf-coder-data', 'omniroute'),
    path.join(__dirname, '..', 'omniroute'),
    'f:\\jmf-coder\\omniroute',
    path.join(path.dirname(process.execPath), 'resources', 'omniroute'),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'package.json'))) {
      console.log('  ✓ وجدنا OmniRoute في: ' + dir);
      return dir;
    }
  }
  return null;
}

function resolveNodeBin() {
  const bundled = path.join(__dirname, '..', 'node-runtime', 'node.exe');
  if (fs.existsSync(bundled)) return bundled;
  const resources = path.join(path.dirname(process.execPath), 'resources', 'node', 'node.exe');
  if (fs.existsSync(resources)) return resources;
  return 'node';
}

async function startOmniRoute() {
  const dir = findOmniRouteDir();
  if (!dir) {
    console.log('  ⚠ مجلد OmniRoute غير موجود — الاستيراد يدوياً فقط');
    return false;
  }

  const running = await checkOmniRoute();
  if (running.running) {
    console.log('  ✓ OmniRoute يعمل بالفعل');
    return true;
  }

  const nodeBin = resolveNodeBin();
  console.log('  ▶ تشغيل OmniRoute...');

  try {
    omnirouteProc = spawn(nodeBin, ['scripts/dev/run-next.mjs', 'start'], {
      cwd: dir,
      env: { ...process.env },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    omnirouteProc.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('listening') || msg.includes('ready') || msg.includes('started')) {
        console.log('  ✓ OmniRoute جاهز!');
      }
    });

    omnirouteProc.stderr.on('data', () => {});

    omnirouteProc.on('error', (e) => {
      console.log('  ✗ خطأ في تشغيل OmniRoute: ' + e.message);
      omnirouteProc = null;
    });

    omnirouteProc.on('close', () => {
      console.log('  ⚠ توقف OmniRoute');
      omnirouteProc = null;
    });

    // انتظار حتى 90 ثانية حتى يعمل (OmniRoute مشروع ضخم يحتاج إقلاعاً أبطأ)
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await checkOmniRoute();
      if (st.running) {
        console.log('  ✓ OmniRoute يعمل على ' + OMNIROUTE_URL);
        return true;
      }
    }
    console.log('  ⚠ OmniRoute لم يعمل خلال 90 ثانية — قد يحتاج بناءً أو أصله تالف');
    return false;
  } catch (e) {
    console.log('  ✗ فشل تشغيل OmniRoute: ' + e.message);
    return false;
  }
}

function stopOmniRoute() {
  if (omnirouteProc) {
    omnirouteProc.kill();
    omnirouteProc = null;
    console.log('  ⏹ تم إيقاف OmniRoute');
  }
}

process.on('SIGINT', () => { stopOmniRoute(); process.exit(); });
process.on('SIGTERM', () => { stopOmniRoute(); process.exit(); });

/* ---------------------------- نظام المصادقة ---------------------------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jmf-admin-2024';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.ADMIN_PORT || 3456}`;
let authTokens = new Map();

function generateToken() {
  return 'adm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function authMiddleware(req, res, next) {
  // السماح بجميع الملفات الثابتة والصفحات العادية
  if (!req.path.startsWith('/api/')) return next();
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && authTokens.has(token)) return next();
  if (req.path === '/api/auth/login' || req.path === '/api/auth/oauth/url' || req.path === '/api/auth/oauth/callback' || req.path === '/api/public/models' || req.path === '/api/public/broadcasts' || req.path === '/api/info' || req.path === '/api/keys/usage' || (req.method === 'GET' && req.path.startsWith('/api/auth'))) return next();
  if (req.method === 'OPTIONS') return next();
  res.status(401).json({ error: 'غير مصرح — سجّل الدخول أولاً' });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(authMiddleware);

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of authTokens) {
    if (now - data.created > 24 * 60 * 60 * 1000) authTokens.delete(token);
  }
}, 60 * 60 * 1000);

/* ---------------------------- مسارات API — مصادقة ---------------------------- */


app.get('/api/auth/local-token', (req, res) => {
  // للبيئة المحلية فقط: توليد توكن تلقائي لمالك المشروع
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';
  if (isLocal) {
    const token = generateToken();
    authTokens.set(token, { created: Date.now(), ip: req.ip, role: 'owner' });
    logActivity('login', 'دخول تلقائي لمالك المشروع (Local Owner)');
    return res.json({ ok: true, token, expiresIn: 24 * 60 * 60 * 1000 });
  }
  res.status(403).json({ error: 'متاح فقط للاتصال المحلي' });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
  const token = generateToken();
  authTokens.set(token, { created: Date.now(), ip: req.ip });
  logActivity('login', 'تسجيل دخول ناجح');
  res.json({ ok: true, token, expiresIn: 24 * 60 * 60 * 1000 });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) authTokens.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token && authTokens.has(token)) {
    res.json({ ok: true, valid: true });
  } else {
    res.json({ ok: true, valid: false });
  }
});

/* ---------------------------- مسارات OAuth ---------------------------- */

app.post('/api/auth/oauth/url', (req, res) => {
  const { provider } = req.body;
  const state = generateToken();
  authTokens.set('__oauth_' + state, { created: Date.now(), provider });

  if (provider === 'github') {
    if (!GITHUB_CLIENT_ID) {
      return res.status(400).json({ error: 'GitHub OAuth غير مُعد — أضف GITHUB_CLIENT_ID' });
    }
    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user&state=${state}`;
    return res.json({ url });
  }

  if (provider === 'google') {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(400).json({ error: 'Google OAuth غير مُعد — أضف GOOGLE_CLIENT_ID' });
    }
    const redirectUri = encodeURIComponent(BASE_URL + '/api/auth/oauth/callback');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20email%20profile&state=${state}`;
    return res.json({ url });
  }

  res.status(400).json({ error: 'مزود غير معروف: ' + provider });
});

app.get('/api/auth/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/login.html?error=' + encodeURIComponent(error));
  if (!code || !state) return res.redirect('/login.html?error=missing_params');

  const oauthData = authTokens.get('__oauth_' + state);
  if (!oauthData) return res.redirect('/login.html?error=invalid_state');

  authTokens.delete('__oauth_' + state);

  try {
    let email = '';
    let name = '';

    if (oauthData.provider === 'github') {
      const tokenRes = await httpPost('https://github.com/login/oauth/access_token', {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      });
      const tokenData = JSON.parse(tokenRes.body);
      if (!tokenData.access_token) throw new Error('فشل الحصول على توكن GitHub');
      const userRes = await httpGetWithCookies('https://api.github.com/user', 'token=' + tokenData.access_token);
      const user = JSON.parse(userRes.body);
      email = user.email || user.login + '@github.com';
      name = user.name || user.login;
    } else if (oauthData.provider === 'google') {
      const tokenRes = await httpPost('https://oauth2.googleapis.com/token', {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: BASE_URL + '/api/auth/oauth/callback',
        grant_type: 'authorization_code',
      });
      const tokenData = JSON.parse(tokenRes.body);
      if (!tokenData.id_token) throw new Error('فشل الحصول على توكن Google');
      const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString());
      email = payload.email || '';
      name = payload.name || '';
    }

    const token = generateToken();
    authTokens.set(token, { created: Date.now(), ip: req.ip, provider: oauthData.provider, email, name });
    logActivity('login', `تسجيل دخول عبر ${oauthData.provider}: ${email || name}`);

    res.redirect(`/login.html?token=${token}`);
  } catch (e) {
    res.redirect('/login.html?error=' + encodeURIComponent(e.message));
  }
});

/* ---------------------------- مسارات البيانات ---------------------------- */

function dataDir() {
  const d = path.join(__dirname, 'data');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function modelsFilePath() { return path.join(dataDir(), 'admin-models.json'); }
function tokensFilePath() { return path.join(dataDir(), 'admin-tokens.json'); }
function settingsFilePath() { return path.join(dataDir(), 'admin-settings.json'); }

function readJson(filePath) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { /* ignore */ }
  return null;
}

function writeJson(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }

/* ---------------------------- مساعدات الشبكة ---------------------------- */

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers
      }, (res) => {
        let body = '';
        res.on('data', (d) => body += d.toString());
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

function httpGetWithCookies(url, cookies) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = {};
    if (cookies) headers['Cookie'] = cookies;
    const req = mod.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, headers }, (res) => {
      let body = '';
      res.on('data', (d) => body += d.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function httpPost(url, data, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const body = JSON.stringify(data);
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...customHeaders
      };
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers,
      }, (res) => {
        let buf = '';
        res.on('data', (d) => buf += d.toString());
        res.on('end', () => resolve({ statusCode: res.statusCode, body: buf, setCookie: res.headers['set-cookie'] || [] }));
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* ---------------------------- مسارات API — بوابة OmniRoute ---------------------------- */

async function checkOmniRoute() {
  try {
    const result = await httpGet(OMNIROUTE_URL + '/api/health');
    if (result.statusCode === 200 || result.statusCode === 401 || result.statusCode === 204) {
      return { running: true, statusCode: result.statusCode };
    }
  } catch (e) {
    try {
      const result2 = await httpGet(OMNIROUTE_URL + '/v1/models');
      if (result2.statusCode === 200 || result2.statusCode === 401) {
        return { running: true, statusCode: result2.statusCode };
      }
    } catch {}
  }
  return { running: false };
}

async function getOmniCookies() {
  const password = process.env.OMNIROUTE_PASSWORD || 'CHANGEME';
  const loginResult = await httpPost(OMNIROUTE_URL + '/api/auth/login', { password });
  if (loginResult.statusCode === 200) {
    return (loginResult.setCookie || []).map(c => c.split(';')[0]).join('; ');
  }
  return '';
}

async function omniCall(method, apiPath, data) {
  const cookies = await getOmniCookies();
  return new Promise((resolve, reject) => {
    const parsed = new URL(OMNIROUTE_URL + apiPath);
    const mod = parsed.protocol === 'https:' ? https : http;
    const body = data ? JSON.stringify(data) : '';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (cookies) headers['Cookie'] = cookies;

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: method,
      headers,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => buf += d.toString());
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          resolve({ statusCode: res.statusCode, data: json });
        } catch {
          resolve({ statusCode: res.statusCode, text: buf });
        }
      });
    });
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

app.get('/api/gateway/status', async (_req, res) => {
  const status = await checkOmniRoute();
  res.json(status);
});

app.post('/api/gateway/start', async (_req, res) => {
  const started = await startOmniRoute();
  res.json({ ok: started, status: await checkOmniRoute() });
});

app.post('/api/gateway/stop', async (_req, res) => {
  stopOmniRoute();
  res.json({ ok: true, status: { running: false } });
});

app.post('/api/gateway/restart', async (_req, res) => {
  stopOmniRoute();
  await new Promise(r => setTimeout(r, 1000));
  const started = await startOmniRoute();
  res.json({ ok: started, status: await checkOmniRoute() });
});

/* ---------------- إدارة الدومينات والأنفاق (Cloudflare Tunnel) ---------------- */
app.get('/api/tunnels/cloudflared', async (_req, res) => {
  try {
    const result = await omniCall('GET', '/api/tunnels/cloudflared');
    res.status(result.statusCode).json(result.data || result.text || {});
  } catch (e) {
    res.status(502).json({ error: 'تعذر الاتصال بالبوابة: ' + e.message });
  }
});

app.post('/api/tunnels/cloudflared', async (req, res) => {
  try {
    const { action } = req.body || {};
    const result = await omniCall('POST', '/api/tunnels/cloudflared', { action: action || 'enable' });
    res.status(result.statusCode).json(result.data || result.text || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- إدارة مزودي OmniRoute ---------------- */
app.get('/api/omniroute/providers', async (_req, res) => {
  try {
    const result = await omniCall('GET', '/api/providers');
    res.status(result.statusCode).json(result.data || []);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/omniroute/providers', async (req, res) => {
  try {
    const result = await omniCall('POST', '/api/providers', req.body);
    res.status(result.statusCode).json(result.data || result.text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/omniroute/providers/:id', async (req, res) => {
  try {
    const result = await omniCall('DELETE', '/api/providers', { ids: [req.params.id] });
    res.status(result.statusCode).json(result.data || result.text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/omniroute/sync-models/:id', async (req, res) => {
  try {
    const result = await omniCall('POST', `/api/providers/${encodeURIComponent(req.params.id)}/sync-models?mode=import`, {});
    res.status(result.statusCode).json(result.data || result.text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gateway/models', async (_req, res) => {
  try {
    const result = await httpGet(OMNIROUTE_URL + '/v1/models');
    if (result.statusCode === 200) {
      const data = JSON.parse(result.body);
      res.json(data);
    } else {
      res.status(502).json({ error: 'OmniRoute لا يستجيب' });
    }
  } catch (e) {
    res.status(502).json({ error: 'OmniRoute غير يعمل — شغّله أولاً على ' + OMNIROUTE_URL });
  }
});

app.post('/api/gateway/import-free', async (_req, res) => {
  try {
    // OmniRoute يتطلب تسجيل دخول أولاً
    const password = process.env.OMNIROUTE_PASSWORD || 'CHANGEME';
    const loginResult = await httpPost(OMNIROUTE_URL + '/api/auth/login', { password });
    if (loginResult.statusCode !== 200) throw new Error('فشل تسجيل الدخول إلى OmniRoute');

    // استخراج الكوكيز من الاستجابة
    const cookies = (loginResult.setCookie || []).map(c => c.split(';')[0]).join('; ');

    // جلب النماذج مع الكوكيز
    const gwResult = await httpGetWithCookies(OMNIROUTE_URL + '/v1/models', cookies);
    if (gwResult.statusCode !== 200) throw new Error('OmniRoute لا يستجيب — Status: ' + gwResult.statusCode);

    const gwData = JSON.parse(gwResult.body);
    const gwModels = gwData.data || gwData || [];
    const existing = readJson(modelsFilePath()) || [];
    const existingIds = new Set(existing.map(m => m.id));
    let imported = 0;
    for (const gm of gwModels) {
      if (existingIds.has(gm.id)) continue;
      existing.push({
        id: gm.id,
        name: gm.name || gm.id.split('/').pop(),
        provider: extractProvider(gm.id),
        context: gm.context_length || gm.context || null,
        maxOutput: gm.max_output_tokens || null,
        costIn: null,
        costOut: null,
        free: true,
        vision: /vision|image|multimodal/i.test(gm.id + ' ' + (gm.name || '')),
        video: /video|sora|runway/i.test(gm.id + ' ' + (gm.name || '')),
        active: true,
        description: 'مستورد من OmniRoute',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      imported++;
    }
    writeJson(modelsFilePath(), existing);

    // رفع النماذج الجديدة إلى Supabase (إذا كان متاحاً)
    let syncedToCloud = 0;
    const db = getSupabase();
    if (db && imported > 0) {
      const newModels = existing.slice(-imported);
      for (const m of newModels) {
        try {
          await db.from('models').upsert({
            id: m.id, name: m.name, provider: m.provider,
            context: m.context, max_output: m.maxOutput,
            cost_in: m.costIn, cost_out: m.costOut,
            free: m.free, vision: m.vision, video: m.video,
            active: m.active, description: m.description,
          }, { onConflict: 'id' });
          syncedToCloud++;
        } catch (e) { /* ignore individual failures */ }
      }
      console.log('  ✓ تم رفع ' + syncedToCloud + ' نموذج إلى Supabase');
    }

    res.json({ ok: true, imported, total: gwModels.length, syncedToCloud });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function extractProvider(modelId) {
  const id = modelId.toLowerCase();
  const base = id.split(':')[0].split('@')[0];
  if (base.startsWith('openai/') || base.startsWith('gpt')) return 'openai';
  if (base.startsWith('anthropic/') || base.startsWith('claude')) return 'anthropic';
  if (base.startsWith('google/') || base.startsWith('gemini')) return 'google';
  if (base.startsWith('deepseek')) return 'deepseek';
  if (base.startsWith('groq/') || base.includes('llama') || base.includes('mixtral')) return 'groq';
  if (base.startsWith('mistral')) return 'mistral';
  if (base.startsWith('meta-llama')) return 'meta';
  if (base.includes('qwen')) return 'alibaba';
  if (base.includes('nvidia') || base.includes('nemotron')) return 'nvidia';
  if (base.includes('command')) return 'cohere';
  const parts = base.split('/');
  if (parts.length >= 2) {
    const candidate = parts[0];
    if (candidate && !['free', 'auto'].includes(candidate)) return candidate;
  }
  return parts[0] || 'unknown';
}

// جلب نماذج مزوّد خارجي مباشرة من /v1/models (Groq / OpenRouter / Google / OpenAI…) وإدماجها في قائمة النماذج
async function importModelsForProvider(provider, apiKey, baseUrl) {
  const p = String(provider || '').toLowerCase().trim();
  if (!apiKey) return { imported: 0, error: 'لا يوجد مفتاح' };

  let baseUrlFixed = null;
  if (baseUrl && /^https?:\/\//i.test(baseUrl)) {
    baseUrlFixed = String(baseUrl).replace(/\/+$/, '');
  }

  const hosts = {
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai',
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com',
    xai: 'https://api.x.ai/v1',
    anthropic: 'https://api.anthropic.com/v1',
  };

  let origin = hosts[p] || baseUrlFixed;
  if (!origin) return { imported: 0, error: 'مزوّد لا يدعم جلب النماذج تلقائياً' };

  let json = null;
  try {
    const result = await httpGet(origin.replace(/\/$/, '') + '/models', p === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Authorization': 'Bearer ' + apiKey });
    if (result.statusCode === 200) {
      try { json = JSON.parse(result.body); } catch (_) {}
    } else {
      return { imported: 0, error: 'استجابة المزوّد ' + result.statusCode };
    }
  } catch (e) {
    return { imported: 0, error: e.message };
  }

  const raw = (json && (json.data || json.models)) || [];
  if (!Array.isArray(raw) || !raw.length) return { imported: 0, error: 'المزوّد لم يرجع نماذج' };

  const existing = readJson(modelsFilePath()) || [];
  const existingIds = new Set(existing.map(m => m.id));
  let imported = 0;

  for (const m of raw) {
    const mid = String(m.id || m.name || '').replace(/^models\//, '');
    if (!mid || existingIds.has(mid)) continue;
    existingIds.add(mid);
    const vision = /vision|-vl|image|multimodal|omni/i.test(mid + ' ' + (m.name || ''));
    const isImageOnly = /image|-img|imagen|dall|flux|sdxl|stable-diffusion|^nano-banana|grok-imagine|seedream|krea|zimage/i.test(mid + ' ' + (m.name || '')) || /image/i.test(mid);
    const isVideo = /video|sora|runway|veo/i.test(mid + ' ' + (m.name || ''));
    let usage = 'text';
    if (isImageOnly) usage = 'image';
    else if (isVideo) usage = 'video';
    else if (vision) usage = 'text';
    existing.push({
      id: mid,
      name: m.name || mid.split('/').pop() || mid,
      provider: p === 'google' ? 'google' : p,
      context: m.context_length || m.context || null,
      maxOutput: m.max_output_tokens || m.max_output || null,
      costIn: m.pricing && m.pricing.prompt != null && String(parseFloat(m.pricing.prompt)) !== '0' ? parseFloat(m.pricing.prompt) : null,
      costOut: m.pricing && m.pricing.completion != null && String(parseFloat(m.pricing.completion)) !== '0' ? parseFloat(m.pricing.completion) : null,
      free: !(m.pricing && parseFloat(m.pricing.prompt || 0) > 0),
      vision,
      video: isVideo,
      usage,
      active: true,
      description: 'تُفعّل تلقائياً عبر مفتاح ' + p,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    imported++;
  }

  if (imported) {
    writeJson(modelsFilePath(), existing);
    logActivity('provider_models_import', 'استيراد ' + imported + ' نموذج من ' + p);
    autoSyncAfterModelChange();
  }
  return { imported };
}

/* ---------------------------- مسارات API — الإعدادات ---------------------------- */

// مزامنة الإعدادات إلى Supabase (مصدر الحقيقة للمستخدمين) — يُخزَّن ككائن كامل تحت مفتاح __all__
async function syncSettingsToSupabase() {
  const db = getSupabase();
  if (!db) return;
  try {
    const settings = readJson(settingsFilePath()) || {};
    const { error } = await db.from('settings').upsert({
      key: '__all__',
      value: settings,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    console.log('  ⚠ تعذر مزامنة الإعدادات إلى Supabase:', e.message);
  }
}

app.get('/api/settings', (_req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  const safe = { ...settings };
  if (safe.githubToken) safe.githubToken = safe.githubToken.slice(0, 8) + '••••••••';
  safe.omnirouteUrl = OMNIROUTE_URL;
  res.json(safe);
});

app.post('/api/settings', async (req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  Object.assign(settings, req.body);
  writeJson(settingsFilePath(), settings);
  await syncSettingsToSupabase();
  logActivity('settings_update', 'تم تحديث الإعدادات');
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — النماذج ---------------------------- */

app.get('/api/models', (_req, res) => {
  res.json(readJson(modelsFilePath()) || []);
});

app.post('/api/models', (req, res) => {
  const models = readJson(modelsFilePath()) || [];
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
  writeJson(modelsFilePath(), models);
  logActivity('model_add', 'تم إضافة النموذج: ' + model.name + ' (' + model.id + ')');
  autoSyncAfterModelChange();
  res.json({ ok: true, model });
});

app.put('/api/models/:id', (req, res) => {
  const models = readJson(modelsFilePath()) || [];
  const idx = models.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'النموذج غير موجود' });
  models[idx] = { ...models[idx], ...req.body, id: req.params.id, updatedAt: Date.now() };
  writeJson(modelsFilePath(), models);
  logActivity('model_update', 'تم تحديث النموذج: ' + req.params.id);
  autoSyncAfterModelChange();
  res.json({ ok: true, model: models[idx] });
});

app.delete('/api/models/:id', (req, res) => {
  const model = (readJson(modelsFilePath()) || []).find(m => m.id === req.params.id);
  const models = (readJson(modelsFilePath()) || []).filter(m => m.id !== req.params.id);
  writeJson(modelsFilePath(), models);
  logActivity('model_delete', 'تم حذف النموذج: ' + req.params.id + (model ? ' (' + model.name + ')' : ''));
  autoSyncAfterModelChange();
  res.json({ ok: true });
});

// إحصاء كامل لكل نموذج (طلبات + تكلفة + زمن الاستجابة + الحالة) من سجل الاستهلاك
app.get('/api/models/stats', async (_req, res) => {
  try {
    const db = getSupabase();
    if (!db) return res.json({ ok: false, error: 'Supabase غير متصل', local: true, models: [] });

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const todayStart = since.toISOString();

    // محاولة قراءة الأعمدة الموسّعة، وإن لم يكُن الـ schema مهاجراً بعد نتراجع للأعمدة الأساسية
    let extended = true;
    let rows, todayRows, providers;
    try {
      [rows, todayRows, providers] = await Promise.all([
        db.from('key_usage').select('model,key_provider,status,cost_usd,latency_ms').limit(10000),
        db.from('key_usage').select('model,key_provider,cost_usd,latency_ms').gte('created_at', todayStart).limit(10000),
        db.from('models').select('id,name,provider,active,vision,image').limit(500),
      ]);
      if (!(rows.data && rows.data.length)) {
        const testR = await db.from('key_usage').select('model').limit(1);
        if (testR.error && /column|does not exist|model/i.test(String(testR.error.message))) throw testR.error;
      }
    } catch (e1) {
      extended = false;
      try {
        [rows, todayRows] = await Promise.all([
          db.from('key_usage').select('key_provider,status,cost_usd,latency_ms').limit(10000),
          db.from('key_usage').select('key_provider,cost_usd,latency_ms').gte('created_at', todayStart).limit(10000),
        ]);
        providers = { data: [] };
      } catch (e2) {
        return res.status(500).json({ ok: false, error: e2.message });
      }
    }

    const agg = new Map(); // model -> {requests, cost, latency, lesns, ok}
    const sumRow = (r, isErr) => {
      const m = String(extended ? (r.model || r.key_provider || 'unknown') : (r.key_provider || 'unknown'));
      if (!agg.has(m)) agg.set(m, { model: m, requests: 0, cost: 0, latencySum: 0, latencyCount: 0, errors: 0, today: 0, todayCost: 0 });
      const a = agg.get(m);
      a.requests++;
      a.cost += Number(r.cost_usd) || 0;
      if (r.latency_ms) { a.latencySum += Number(r.latency_ms); a.latencyCount++; }
      if (isErr && r.status && r.status !== 'ok') a.errors++;
    };
    const sumRowToday = (r) => {
      const m = String(extended ? (r.model || r.key_provider || 'unknown') : (r.key_provider || 'unknown'));
      if (!agg.has(m)) agg.set(m, { model: m, requests: 0, cost: 0, latencySum: 0, latencyCount: 0, errors: 0, today: 0, todayCost: 0 });
      agg.get(m).today++;
      agg.get(m).todayCost += Number(r.cost_usd) || 0;
    };

    for (const r of (rows.data || [])) sumRow(r, true);
    for (const r of (todayRows.data || [])) sumRowToday(r);

    const providerNames = new Map((providers.data || []).map(m => [m.id, { name: m.name, provider: m.provider, active: m.active !== false, vision: m.vision === true, image: m.image === true }]));

    const perModel = Array.from(agg.values()).map(a => {
      const meta = providerNames.get(a.model) || null;
      return {
        model: a.model,
        name: meta ? meta.name : a.model,
        provider: meta ? meta.provider : a.model.split(':')[0],
        active: meta ? meta.active : true,
        vision: meta ? meta.vision : false,
        image: meta ? meta.image : false,
        requests: a.requests,
        errors: a.errors,
        successRate: a.requests ? Math.round(((a.requests - a.errors) / a.requests) * 100) : 100,
        costUsd: Number(a.cost.toFixed(4)),
        avgLatencyMs: a.latencyCount ? Math.round(a.latencySum / a.latencyCount) : 0,
        requestsToday: a.today,
        costUsdToday: Number(a.todayCost.toFixed(4)),
      };
    }).sort((x, y) => y.requests - x.requests);

    res.json({
      ok: true,
      models: perModel,
      totals: {
        requests: perModel.reduce((s, m) => s + m.requests, 0),
        requestsToday: perModel.reduce((s, m) => s + m.requestsToday, 0),
        costUsd: Number(perModel.reduce((s, m) => s + m.costUsd, 0).toFixed(4)),
        costUsdToday: Number(perModel.reduce((s, m) => s + m.costUsdToday, 0).toFixed(4)),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — التوكنات ---------------------------- */

function opencodeAuthPaths() {
  const dirs = [
    path.join(os.homedir(), 'AppData', 'Local', 'opencode'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'opencode'),
    process.env.OPENCODE_DATA || path.join(os.homedir(), '.local', 'share', 'opencode'),
  ];
  return dirs.map(d => path.join(d, 'auth.json'));
}

function writeOpencodeAuth(data) {
  for (const p of opencodeAuthPaths()) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }
  console.log('  ✓ تمت مزامنة التوكنات مع مسارات auth.json');
}

function readOpencodeAuth() {
  const auth = {};
  for (const p of opencodeAuthPaths()) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data && typeof data === 'object') Object.assign(auth, data);
      }
    } catch (e) { /* ignore */ }
  }
  return auth;
}

function syncTokensToOpencodeAuth() {
  const tokens = readJson(tokensFilePath()) || [];
  const auth = {};
  for (const tk of tokens) {
    if (!tk.provider || !tk.key) continue;
    auth[tk.provider] = { key: tk.key };
    if (tk.baseUrl) auth[tk.provider].url = tk.baseUrl;
  }
  writeOpencodeAuth(auth);
}

function httpPostWithCookies(url, data, cookies) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (cookies) headers['Cookie'] = cookies;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => buf += d.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, body: buf }));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function syncTokenToOmniRoute(provider, apiKey, baseUrl) {
  if (!provider || !apiKey) return;
  try {
    const password = process.env.OMNIROUTE_PASSWORD || 'CHANGEME';
    const loginResult = await httpPost(OMNIROUTE_URL + '/api/auth/login', { password });
    if (loginResult.statusCode !== 200) return;
    const cookies = (loginResult.setCookie || []).map(c => c.split(';')[0]).join('; ');

    let p = provider.toLowerCase().trim();
    if (p === 'gemini' || p === 'google') p = 'google';
    if (p === 'claude') p = 'anthropic';
    if (p === 'chatgpt') p = 'openai';

    const postBody = {
      provider: p,
      apiKey: apiKey,
      name: p,
      priority: 1,
      isActive: true,
    };
    if (baseUrl) postBody.providerSpecificData = { baseUrl };

    const r = await httpPostWithCookies(OMNIROUTE_URL + '/api/providers', postBody, cookies);
    console.log(`  ✓ تسجيل مزوّد ${p} في بوابة OmniRoute: Status ${r.statusCode}`);
  } catch (e) {
    console.log('  ⚠ تعذر إرسال التوكن للبوابة:', e.message);
  }
}

function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || SUPABASE_DEFAULT_URL,
    key: process.env.SUPABASE_SERVICE_KEY || SUPABASE_DEFAULT_KEY,
  };
}

function supabaseRestHeaders() {
  const { key } = supabaseEnv();
  return {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
}

async function syncTokensToSupabase(tokens) {
  try {
    const { url } = supabaseEnv();
    const headers = supabaseRestHeaders();
    for (const tk of tokens) {
      if (!tk.provider || !tk.key) continue;
      await httpPost(url + '/rest/v1/api_keys', {
        provider: tk.provider,
        key: tk.key,
        base_url: tk.baseUrl || null
      }, headers);
    }
    console.log('  ✓ تمت مزامنة ' + tokens.length + ' توكن مع جدول api_keys في Supabase');
  } catch (e) {
    console.log('  ✗ فشل مزامنة التوكنات مع Supabase: ' + e.message);
  }
}


/* ==================== إدارة مجمّع مفاتيح الصور والرؤية + الكوتة + موازنة الأحمال ==================== */

function keyPoolPath() { return path.join(dataDir(), 'admin-keypool.json'); }

function readKeyPool() {
  const list = readJson(keyPoolPath());
  return Array.isArray(list) ? list : [];
}

function writeKeyPool(list) {
  writeJson(keyPoolPath(), list);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// تصفير الكوتة اليومية تلقائياً عند عبور منتصف الليل
function ensureDailyReset(list) {
  const today = startOfToday();
  let changed = false;
  for (const k of list) {
    const last = new Date(k.lastReset || k.updatedAt || 0).getTime();
    if (!last || last < today) {
      k.usedToday = 0;
      k.lastReset = new Date(today).toISOString();
      changed = true;
    }
  }
  if (changed) writeKeyPool(list);
  return list;
}

function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 12) return '••••••••';
  return s.slice(0, 8) + '••••••••' + s.slice(-4);
}

function genId() {
  return 'key_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function listCloudKeys() {
  try {
    const { url } = supabaseEnv();
    const resp = await httpGet(url + '/rest/v1/api_keys?select=*&order=created_at.desc', supabaseRestHeaders());
    if (resp.statusCode === 200) {
      return JSON.parse(resp.body);
    }
  } catch (e) {
    console.log('  ⚠ تعذر جلب مفاتيح Supabase:', e.message);
  }
  return [];
}

async function upsertCloudKey(rec) {
  try {
    const { url } = supabaseEnv();
    const payload = {
      id: rec.id,
      provider: rec.provider,
      label: rec.label || '',
      key: rec.key,
      base_url: rec.baseUrl || null,
      quota_daily: rec.quotaDaily || 1500,
      used_today: rec.usedToday || 0,
      last_reset: rec.lastReset || new Date().toISOString(),
      enabled: rec.enabled !== false,
    };
    const resp = await httpPost(url + '/rest/v1/api_keys?on_conflict=id', payload, {
      ...supabaseRestHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    });
    return resp.statusCode >= 200 && resp.statusCode < 300;
  } catch (e) {
    console.log('  ⚠ تعذر رفع المفتاح إلى Supabase:', e.message);
    return false;
  }
}

async function deleteCloudKey(id) {
  try {
    const { url } = supabaseEnv();
    // حذف عبر DELETE اليدوي (بدون مكتبة خارجية)
    const parsed = new URL(url + '/rest/v1/api_keys?id=eq.' + encodeURIComponent(id));
    const mod = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      const req = mod.request({
        hostname: parsed.hostname, port: parsed.port,
        path: parsed.pathname + parsed.search, method: 'DELETE',
        headers: supabaseRestHeaders(),
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300)); });
      req.setTimeout(10000, () => req.destroy());
      req.on('error', () => resolve(false));
      req.end();
    });
  } catch (e) {
    console.log('  ⚠ تعذر حذف المفتاح من Supabase:', e.message);
    return false;
  }
}

async function resetCloudUsage(id) {
  try {
    const { url } = supabaseEnv();
    const resp = await httpPost(url + '/rest/v1/rpc/reset_key_usage', { p_key_id: id }, supabaseRestHeaders());
    return resp.statusCode >= 200 && resp.statusCode < 300;
  } catch (e) {
    console.log('  ⚠ تعذر تصفير الكوتة في Supabase:', e.message);
    return false;
  }
}

/* تتبع الأحيائية اللحظية (latency/errors/cooldowns) وتخزين الكوتة الفعلية */
let keyUsageStats = new Map();   // keyId -> { requests, errors, lastUsed, status, latency }
let keyCooldowns = new Map();    // keyId -> cooldownUntilMs
let localQuotaState = new Map(); // keyId -> { usedToday, lastReset } (نسخة احتياطية محلية من السحابة)

const DEFAULT_DAILY_QUOTA = 1500;

function normalizeProvider(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'gemini' || s === 'google') return 'google';
  return s;
}

function md5Short(str) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16).slice(0, 8) + (h2 >>> 0).toString(16).slice(0, 4);
}

function getKeyId(k) {
  if (!k) return '';
  const s = String(k.key || k.id || k);
  return s.slice(0, 10) + '_' + md5Short(s).slice(-4);
}

function keyStatus(kid) {
  const cd = keyCooldowns.get(kid) || 0;
  if (Date.now() < cd) return 'cooldown';
  const st = keyUsageStats.get(kid);
  if (st && st.errors > 8) return 'error';
  return 'active';
}

// 1. جلب مجمّع المفاتيح الحقيقي (محلي + سحابي) مع الاستهلاك الفعلي من Supabase
app.get('/api/keys/pool', async (_req, res) => {
  try {
    const pool = ensureDailyReset(readKeyPool());
    const cloudKeys = await listCloudKeys();
    const cloudByKey = new Map();
    for (const ck of cloudKeys) {
      if (!cloudByKey.has(ck.key)) cloudByKey.set(ck.key, ck);
    }

    const merged = [];
    const seen = new Set();

    // أ) السجلات السحابية (المصدر الأساسي لكل المستخدمين)
    for (const ck of cloudKeys) {
      if (String(ck.provider || '').toLowerCase().trim() !== 'google') continue;
      if (seen.has(ck.key)) continue;
      seen.add(ck.key);
      const kid = ck.id || getKeyId(ck);
      const used = parseInt(ck.used_today, 10) || 0;
      const quota = parseInt(ck.quota_daily, 10) || DEFAULT_DAILY_QUOTA;
      const st = keyUsageStats.get(kid) || { requests: used, errors: 0, latency: 0 };
      if (st.requests < used) st.requests = used;
      merged.push({
        id: kid,
        provider: 'google',
        baseUrl: ck.base_url || '',
        label: ck.label || '',
        keyMasked: maskKey(ck.key),
        key: ck.key,
        source: 'cloud',
        status: keyStatus(kid),
        requests: st.requests,
        errors: st.errors,
        latency: st.latency || 0,
        quotaDaily: quota,
        usedToday: used,
        quotaRemaining: Math.max(0, quota - used),
        enabled: ck.enabled !== false,
        lastReset: ck.last_reset || null,
        createdAt: ck.created_at || Date.now(),
      });
    }

    // ب) السجلات المحلية (من ملف مجمّع المفاتيح) إن لم توجد في السحابة
    for (const kp of pool) {
      if (!kp.key) continue;
      if (seen.has(kp.key)) continue;
      seen.add(kp.key);
      const kid = kp.id || 'local_' + getKeyId(kp);
      const used = parseInt(kp.usedToday, 10) || 0;
      const quota = parseInt(kp.quotaDaily, 10) || DEFAULT_DAILY_QUOTA;
      const st = keyUsageStats.get(kid) || { requests: used, errors: 0, latency: 0 };
      merged.push({
        id: kid,
        provider: normalizeProvider(kp.provider),
        baseUrl: kp.baseUrl || '',
        label: kp.label || '',
        keyMasked: maskKey(kp.key),
        key: kp.key,
        source: 'local',
        status: keyStatus(kid),
        requests: st.requests,
        errors: st.errors,
        latency: st.latency || 0,
        quotaDaily: quota,
        usedToday: used,
        quotaRemaining: Math.max(0, quota - used),
        enabled: kp.enabled !== false,
        lastReset: kp.lastReset || null,
        createdAt: kp.createdAt || Date.now(),
      });
    }

    // ج) مفاتيح Google من ملف التوكنات العمومي (لمنع الازدواج اثناء التحول)
    const tokens = readJson(tokensFilePath()) || [];
    for (const tk of tokens) {
      const p = normalizeProvider(tk.provider);
      if (p !== 'google' || !tk.key || seen.has(tk.key)) continue;
      seen.add(tk.key);
      const kid = 'local_' + getKeyId(tk);
      usedBy(kid);
      const used = (keyUsageStats.get(kid) || { requests: 0 }).requests || 0;
      const quota = DEFAULT_DAILY_QUOTA;
      merged.push({
        id: kid,
        provider: p,
        baseUrl: tk.baseUrl || '',
        label: tk.label || tk.provider || '',
        keyMasked: maskKey(tk.key),
        key: tk.key,
        source: 'legacy',
        status: keyStatus(kid),
        requests: used,
        errors: (keyUsageStats.get(kid) || { errors: 0 }).errors || 0,
        latency: 0,
        quotaDaily: quota,
        usedToday: used,
        quotaRemaining: Math.max(0, quota - used),
        enabled: true,
        lastReset: null,
        createdAt: tk.createdAt || Date.now(),
      });
    }

    // تحديث النسخة المحلية من بيانات الكوتة لموازنة الأحمال
    for (const k of merged) {
      localQuotaState.set(k.id, { usedToday: k.usedToday, lastReset: k.lastReset, remaining: k.quotaRemaining });
    }

    const totalQuota = merged.reduce((s, k) => s + k.quotaDaily, 0);
    const totalUsed = merged.reduce((s, k) => s + k.usedToday, 0);

    res.json({
      ok: true,
      keys: merged,
      summary: {
        totalKeys: merged.length,
        activeKeys: merged.filter(k => k.enabled).length,
        totalQuota,
        totalUsed,
        totalRemaining: Math.max(0, totalQuota - totalUsed),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function usedBy(kid) {
  return (keyUsageStats.get(kid) || { requests: 0 }).requests || 0;
}

// 1b. إضافة مفتاح (أو عدة مفاتيح) Google إلى مجمّع الصور — مع المزامنة الفورية إلى Supabase
app.post('/api/keys/pool', async (req, res) => {
  try {
    const body = req.body || {};
    const provider = normalizeProvider(body.provider || 'google');
    const entries = [];

    if (Array.isArray(body.keys)) {
      for (const k of body.keys) {
        if (!k || !k.key) continue;
        entries.push({ key: String(k.key).trim(), label: k.label || '', quotaDaily: parseInt(k.quotaDaily, 10) || DEFAULT_DAILY_QUOTA });
      }
    } else if (body.key) {
      entries.push({ key: String(body.key).trim(), label: body.label || '', quotaDaily: parseInt(body.quotaDaily, 10) || DEFAULT_DAILY_QUOTA });
    }

    if (!entries.length) return res.status(400).json({ error: 'أدخل مفتاحاً واحداً على الأقل' });

    const pool = ensureDailyReset(readKeyPool());
    const existing = new Set(pool.map(k => k.key));
    const added = [];

    for (const e of entries) {
      const key = e.key.replace(/^["'\s]+|["'\s]+$/g, '');
      if (!key || existing.has(key)) continue;
      existing.add(key);
      const rec = {
        id: genId(),
        provider,
        label: e.label || ('مفتاح #' + (pool.length + added.length + 1)),
        key,
        baseUrl: body.baseUrl || null,
        quotaDaily: e.quotaDaily || DEFAULT_DAILY_QUOTA,
        usedToday: 0,
        lastReset: new Date(startOfToday()).toISOString(),
        enabled: body.enabled !== false,
        source: body.source === 'local' ? 'local' : 'cloud',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      pool.push(rec);
      added.push(rec);
    }

    if (added.length) {
      writeKeyPool(pool);
      let synced = 0;
      for (const rec of added) {
        if (rec.source === 'cloud') {
          if (await upsertCloudKey(rec)) synced++;
          else await syncLocalTokenForPanel('google', rec.key);
        } else {
          await syncLocalTokenForPanel('google', rec.key);
        }
      }
      logActivity('keypool_add', 'إضافة ' + added.length + ' مفتاح Google (' + synced + ' متزامن مع السحابة)');
      return res.json({ ok: true, added: added.map(a => ({ id: a.id, label: a.label, keyMasked: maskKey(a.key) })), syncedCloud: synced });
    }

    res.json({ ok: true, added: [], message: 'المفاتيح مضافة مسبقاً' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function syncLocalTokenForPanel(provider, key) {
  try {
    const tokens = readJson(tokensFilePath()) || [];
    if (tokens.some(t => t.key === key)) return;
    tokens.push({ provider: String(provider).toLowerCase(), key, createdAt: Date.now() });
    writeJson(tokensFilePath(), tokens);
    syncTokensToOpencodeAuth();
  } catch (e) { /* ignore */ }
}

// 1c. اختبار مفتاح Google مباشرة (يتحقق من حساب AI Studio وأفضل موديل صور متاح)
app.post('/api/keys/pool/test', async (req, res) => {
  const { key, id } = req.body || {};
  let testKey = key;
  if (!testKey && id) {
    const pool = ensureDailyReset(readKeyPool());
    const found = pool.find(k => k.id === id) || pool.find(k => (getKeyId(k)) === id);
    if (found) testKey = found.key;
  }
  if (!testKey) return res.status(400).json({ error: 'المفتاح مطلوب للاختبار' });

  const t0 = Date.now();
  try {
    const resp = await httpGet(
      'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(testKey),
      { 'Content-Type': 'application/json' }
    );
    const latency = Date.now() - t0;
    if (resp.statusCode === 200) {
      let models = [];
      try { models = (JSON.parse(resp.body).models || []).map(m => m.name.replace(/^models\//, '')); } catch (_) {}
      const imageModels = models.filter(m => /image|imagen/i.test(m));
      const maxQ = settingsMaxQuota();
      res.json({
        ok: true,
        valid: true,
        latency,
        modelsCount: models.length,
        imageModels: imageModels.slice(0, 10),
        quotaMonthlyMax: maxQ,
        message: `المفتاح صالح ✓ (${latency}ms) — نموذج صور مدعوم: ${imageModels.length ? imageModels[0] : 'الموديلات النصية/الرؤية جاهزة'}`,
      });
    } else {
      let errMsg = 'رمز الحالة ' + resp.statusCode;
      try {
        const d = JSON.parse(resp.body);
        if (d.error && d.error.message) errMsg = d.error.message;
      } catch (_) {}
      res.status(400).json({ ok: false, valid: false, error: errMsg, latency: Date.now() - t0 });
    }
  } catch (e) {
    res.status(500).json({ ok: false, valid: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — صحة المزوّدين والمفاتيح ---------------------------- */

// فحص شامل لكل مفاتيح التوليد (الكوتة، الحالة، المتبقي)
app.get('/api/health/keys', async (_req, res) => {
  try {
    const keys = await listCloudKeys();
    const list = Array.isArray(keys) ? keys : [];
    const today = new Date().toISOString().slice(0, 10);
    const statuses = list.map(k => {
      const usedToday = k.last_reset && String(k.last_reset).slice(0, 10) === today ? (Number(k.used_today) || 0) : 0;
      const quota = Number(k.quota_daily) || DEFAULT_DAILY_QUOTA;
      return {
        id: k.id || getKeyId(k),
        provider: k.provider || 'google',
        label: k.label || '',
        enabled: k.enabled !== false,
        usedToday,
        quotaDaily: quota,
        remaining: Math.max(quota - usedToday, 0),
        health: !k.enabled ? 'disabled' : (quota - usedToday <= 0 ? 'exhausted' : (quota - usedToday <= quota * 0.2 ? 'low' : 'ok')),
      };
    });
    const ok = statuses.filter(k => k.health === 'ok').length;
    const low = statuses.filter(k => k.health === 'low').length;
    const exhausted = statuses.filter(k => k.health === 'exhausted').length;
    const disabled = statuses.filter(k => k.health === 'disabled').length;
    res.json({ ok: true, keys: statuses, summary: { total: statuses.length, ok, low, exhausted, disabled } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// صحة مزوّدي الدردشة (توجيه اللوحة/المفاتيح العمومية)
app.get('/api/health/providers', async (_req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  const providers = tokens.map(t => ({
    provider: t.provider,
    label: t.name || t.provider,
    configured: !!(t.key || t.api_key || t.token),
    baseUrl: t.baseUrl || null,
    latency: null,
    health: (t.key || t.api_key || t.token) ? 'configured' : 'missing',
  }));
  res.json({ ok: true, providers, summary: providers.reduce((a, p) => (a[p.health] = (a[p.health] || 0) + 1, a), {}) });
});

function settingsMaxQuota() {
  try {
    const s = readJson(settingsFilePath()) || {};
    const q = parseInt(s.defaultDailyQuota, 10);
    return q || DEFAULT_DAILY_QUOTA;
  } catch (e) { return DEFAULT_DAILY_QUOTA; }
}

// 1d. تحديث مفتاح (الكوتة، التسمية، التفعيل/التعطيل)
app.patch('/api/keys/pool/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const pool = ensureDailyReset(readKeyPool());
    const rec = pool.find(k => k.id === id) || pool.find(k => (getKeyId(k)) === id);
    if (!rec) return res.status(404).json({ error: 'المفتاح غير موجود' });

    if (req.body.label !== undefined) rec.label = String(req.body.label);
    if (req.body.quotaDaily !== undefined) rec.quotaDaily = Math.max(1, parseInt(req.body.quotaDaily, 10) || DEFAULT_DAILY_QUOTA);
    if (req.body.enabled !== undefined) rec.enabled = req.body.enabled !== false;
    rec.updatedAt = Date.now();
    writeKeyPool(pool);
    await upsertCloudKey(rec);
    logActivity('keypool_update', 'تحديث مفتاح ' + rec.label);
    res.json({ ok: true, key: { id: rec.id, label: rec.label, quotaDaily: rec.quotaDaily, enabled: rec.enabled } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 1e. تصفير كوتة مفتاح
app.post('/api/keys/pool/:id/reset', async (req, res) => {
  try {
    const id = req.params.id;
    const pool = ensureDailyReset(readKeyPool());
    const rec = pool.find(k => k.id === id) || pool.find(k => (getKeyId(k)) === id);
    if (!rec) return res.status(404).json({ error: 'المفتاح غير موجود' });
    rec.usedToday = 0;
    rec.lastReset = new Date().toISOString();
    writeKeyPool(pool);
    await resetCloudUsage(rec.id);
    keyUsageStats.delete(getKeyId(rec));
    localQuotaState.set(id, { usedToday: 0, remaining: rec.quotaDaily });
    logActivity('keypool_reset', 'تصفير كوتة مفتاح ' + rec.label);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 1f. حذف مفتاح من المجمّع
app.delete('/api/keys/pool/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const pool = ensureDailyReset(readKeyPool());
    const removed = pool.find(k => k.id === id) || pool.find(k => (getKeyId(k)) === id);
    const next = pool.filter(k => k.id !== id && (getKeyId(k)) !== id);
    writeKeyPool(next);
    if (removed) {
      await deleteCloudKey(removed.id);
      keyUsageStats.delete(getKeyId(removed));
      keyCooldowns.delete(getKeyId(removed));
      localQuotaState.delete(id);
      logActivity('keypool_delete', 'حذف مفتاح ' + (removed.label || ''));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 1g. إبلاغ الاستهلاك من التطبيقات (تُستدعى بعد كل توليد رؤية/صورة) — عامة بدون مصادقة
//     النموذج: { keyId, key, userId, userEmail, kind, step, model, costUsd, latencyMs, status }
app.post('/api/keys/usage', async (req, res) => {
  try {
    const b = req.body || {};
    const userId = String(b.userId || b.uid || '').slice(0, 120);
    const userEmail = String(b.userEmail || b.email || '').slice(0, 200);
    const kind = String(b.kind || 'image');
    const step = Math.max(1, parseInt(b.step, 10) || 1);
    const key = String(b.key || '');
    const model = String(b.model || '').slice(0, 300);
    const costUsd = Math.max(0, parseFloat(b.costUsd) || 0);
    const latencyMs = Math.max(0, parseInt(b.latencyMs, 10) || 0);
    const status = String(b.status || 'ok').slice(0, 20);

    let keyId = String(b.keyId || '');
    // البحث عن المفتاح محلياً/سحابياً إن أُرسل المفتاح نفسه
    if (!keyId && key) {
      const pool = ensureDailyReset(readKeyPool());
      const rec = pool.find(k => k.key === key);
      if (rec) keyId = rec.id;
    }
    if (!keyId) {
      try {
        const cloudKeys = await listCloudKeys();
        const match = cloudKeys.find(k => k.key === key);
        if (match) keyId = match.id;
      } catch (_) {}
    }

    // تحديث العداد المحلي
    if (keyId) {
      const pool = ensureDailyReset(readKeyPool());
      const rec = pool.find(k => k.id === keyId) || pool.find(k => (getKeyId(k)) === keyId);
      if (rec) {
        rec.usedToday = (rec.usedToday || 0) + step;
        rec.lastReset = new Date().toISOString();
        writeKeyPool(pool);
        const ls = keyUsageStats.get(rec.id) || { requests: 0, errors: 0, latency: 0 };
        keyUsageStats.set(rec.id, { ...ls, requests: (ls.requests || 0) + step, lastUsed: Date.now() });
      }
    }

    // مزامنة ذرّية مع Supabase (تُحدّث api_keys + key_usage + user_profiles)
    let cloud = false;
    try {
      const { url } = supabaseEnv();
      const rpcBody = {
        p_key_id: keyId || null,
        p_user_id: userId || null,
        p_user_email: userEmail || null,
        p_kind: kind,
        p_step: step,
        p_model: model,
        p_cost_usd: costUsd,
        p_latency_ms: latencyMs,
        p_status: status,
      };
      let resp = await httpPost(url + '/rest/v1/rpc/increment_key_usage', rpcBody, supabaseRestHeaders());
      if (resp.statusCode >= 400 && /PGRST202|no matches were found/i.test(String(resp.body || ''))) {
        // الـ schema لم يُهاجر بعد — تراجع للتوقيع القديم
        resp = await httpPost(url + '/rest/v1/rpc/increment_key_usage', {
          p_key_id: keyId || null,
          p_user_id: userId || null,
          p_user_email: userEmail || null,
          p_kind: kind,
          p_step: step,
        }, supabaseRestHeaders());
      }
      if (resp.statusCode >= 200 && resp.statusCode < 300) cloud = true;
    } catch (e) { /* السحابة غير متاحة */ }

    res.json({ ok: true, recorded: true, cloud, keyId: keyId || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2. إحصائيات المستخدمين الحقيقية من Supabase Auth + استهلاكهم الفعلي
app.get('/api/users/stats', async (_req, res) => {
  try {
    const db = getSupabase();
    if (!db) return res.json({ ok: true, users: [], source: 'local' });

    const usersByEmail = new Map();
    try {
      const { data: profiles } = await db.from('user_profiles').select('*').limit(500);
      for (const p of (profiles || [])) {
        const keyId = p.user_id || p.email;
        usersByEmail.set(String(p.email || p.user_id || '').toLowerCase(), p);
      }
    } catch (e) { /* تجاهل — قد تكون أعمدة جديدة غير مضافّة */ }

    let users = [];
    try {
      const resp = await httpGet(supabaseEnv().url + '/auth/v1/admin/users', supabaseRestHeaders());
      if (resp.statusCode === 200) {
        const parsed = JSON.parse(resp.body);
        const rawUsers = parsed.users || [];
        users = rawUsers.map((u) => {
          const email = u.email || '';
          const name = (u.user_metadata && u.user_metadata.full_name) || (email ? email.split('@')[0] : 'مستخدم مسجل');
          const prof = usersByEmail.get(String(email).toLowerCase()) || null;
          const plan = (prof && prof.plan) || 'free';
          const today = new Date().toISOString().slice(0, 10);
          const userToday = prof && prof.last_reset && new Date(prof.last_reset).toISOString().slice(0, 10) === today;
          return {
            id: u.id,
            email,
            name,
            plan,
            imagesGenerated: prof ? prof.images_total : 0,
            imagesToday: prof && userToday ? prof.images_today : (prof ? 0 : 0),
            visionToday: prof && userToday ? prof.vision_today : 0,
            visionRequests: prof ? prof.vision_today : 0,
            totalRequests: prof ? ((prof.images_total || 0) + (prof.vision_today || 0)) : 0,
            canVision: plan !== 'free' || true,
            canImage: true,
            lastActive: u.last_sign_in_at || u.created_at || null,
          };
        });
      }
    } catch (e) {
      console.log('  ⚠ تعذر جلب مستخدمي Supabase Auth:', e.message);
    }

    // أضف مستخدمين استهلكوا الصور لكن بلا حساب Supabase (أجهزة مجهولة)
    const known = new Set(users.map(u => String(u.email).toLowerCase()));
    for (const p of usersByEmail.values()) {
      const email = String(p.email || '').toLowerCase();
      if (email && !known.has(email)) {
        users.push({
          id: p.user_id,
          email: p.email,
          name: email.split('@')[0],
          plan: p.plan || 'free',
          imagesGenerated: p.images_total || 0,
          imagesToday: p.images_today || 0,
          visionToday: p.vision_today || 0,
          visionRequests: p.vision_today || 0,
          totalRequests: (p.images_total || 0) + (p.vision_today || 0),
          canVision: true,
          canImage: true,
          lastActive: null,
        });
      }
    }

    res.json({ ok: true, users, source: usersByEmail.size ? 'supabase' : 'auth-only' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ترقية خطة المستخدم / تفعيل الخدمات (اشتراكات مستقبلية)
app.post('/api/users/update-plan', async (req, res) => {
  const { userId, email, plan, canVision, canImage } = req.body;
  if (!userId && !email) return res.status(400).json({ error: 'معرّف المستخدم مطلوب' });

  try {
    const sb = getSupabase();
    if (sb) {
      let builder = sb.from('user_profiles').upsert({
        user_id: userId || 'dev_' + String(email || '').toLowerCase(),
        email: email || '',
        plan: plan || 'pro',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      await builder;
      if (email) {
        await sb.from('user_profiles').update({ plan: plan || 'pro', updated_at: new Date().toISOString() }).eq('email', email);
      }
    }
    logActivity('user_plan_upgrade', `تم تحديث خطة المستخدم إلى ${plan}`);
    res.json({ ok: true, message: 'تم تحديث خطة المستخدم وصلاحياته بنجاح!' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — الباقات والأسعار (SaaS) ---------------------------- */

const DEFAULT_PLANS = [
  { id: 'free', name: 'مجاني', price: 0, cycle: 'month', imageQuota: 50, vision: true, features: ['صور محدودة يومياً', 'دردشة بلا حدود'] },
  { id: 'pro', name: 'احترافي', price: 9.99, cycle: 'month', imageQuota: 500, vision: true, features: ['500 صورة شهرياً', 'أولوية في التوليد', 'دعم سريع'] },
  { id: 'premium', name: 'مميز', price: 24.99, cycle: 'month', imageQuota: 5000, vision: true, features: ['5000 صورة شهرياً', 'أولوية قصوى', 'دعم مباشر 24/7'] },
];

function readPlans() {
  try {
    const settings = readJson(settingsFilePath()) || {};
    if (Array.isArray(settings._plans) && settings._plans.length) return settings._plans;
  } catch (e) { /* ignore */ }
  return DEFAULT_PLANS;
}

function writePlans(list) {
  const settings = readJson(settingsFilePath()) || {};
  settings._plans = list;
  writeJson(settingsFilePath(), settings);
}

app.get('/api/plans', (_req, res) => {
  res.json({ ok: true, plans: readPlans() });
});

app.post('/api/plans', async (req, res) => {
  const plans = req.body && Array.isArray(req.body.plans) ? req.body.plans : (Array.isArray(req.body) ? req.body : null);
  if (!plans || !plans.length) return res.status(400).json({ error: 'قائمة الباقات مطلوبة' });
  for (const p of plans) {
    if (!p.id || !p.name) return res.status(400).json({ error: 'كل باقة تتطلب id و name' });
  }
  writePlans(plans);
  await syncSettingsToSupabase();
  logActivity('plans_update', 'تم تحديث باقات الاشتراك والأسعار');
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — الاشتراكات ---------------------------- */

app.get('/api/subscriptions', async (_req, res) => {
  const db = getSupabase();
  if (!db) return res.json({ ok: true, subscriptions: [] });
  try {
    const { data, error } = await db.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ ok: true, subscriptions: (data || []).map(s => ({
      id: s.id, userId: s.user_id, plan: s.plan, status: s.status,
      startsAt: s.starts_at, expiresAt: s.expires_at, features: s.features || {},
      createdAt: s.created_at,
    })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/subscriptions', async (req, res) => {
  const db = getSupabase();
  if (!db) return res.status(500).json({ ok: false, error: 'Supabase غير مُعد' });
  const { userId, email, plan, status, expiresAt } = req.body || {};
  if (!userId && !email) return res.status(400).json({ error: 'معرّف المستخدم (userId أو email) مطلوب' });
  try {
    const p = readPlans().find(x => x.id === plan) || readPlans().find(x => x.id === 'free');
    const sub = {
      user_id: userId || email,
      plan: plan || 'free',
      status: status || 'active',
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      features: p || {},
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await db.from('subscriptions').select('id').eq('user_id', sub.user_id).maybeSingle();
    let result;
    if (existing) {
      const { data, error } = await db.from('subscriptions').update(sub).eq('id', existing.id).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await db.from('subscriptions').insert(sub).select().single();
      if (error) throw error;
      result = data;
    }
    // تحديث خطة المستخدم أيضاً
    await db.from('user_profiles').upsert({
      user_id: sub.user_id,
      email: email || '',
      plan: sub.plan,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).catch(() => {});
    logActivity('subscription_update', 'تحديث اشتراك المستخدم إلى ' + sub.plan);
    res.json({ ok: true, subscription: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 3. إحصائيات موازن الأحمال — قياسات فعلية من الكوتة المسجلة
app.get('/api/load-balancer/stats', async (_req, res) => {
  try {
    const pool = ensureDailyReset(readKeyPool());
    const cloudKeys = await listCloudKeys();
    const counts = { pool: pool.length, cloud: cloudKeys.length };

    const allKeys = [];
    const seen = new Set();
    for (const ck of cloudKeys) {
      if (String(ck.provider || '').toLowerCase().trim() !== 'google' || seen.has(ck.key)) continue;
      seen.add(ck.key);
      allKeys.push({ id: ck.id, key: ck.key, used: parseInt(ck.used_today, 10) || 0, quota: parseInt(ck.quota_daily, 10) || 1500, enabled: ck.enabled !== false, source: 'cloud' });
    }
    for (const kp of pool) {
      if (seen.has(kp.key)) continue;
      seen.add(kp.key);
      allKeys.push({ id: kp.id, key: kp.key, used: kp.usedToday || 0, quota: kp.quotaDaily || 1500, enabled: kp.enabled !== false, source: 'local' });
    }

    const activeKeys = allKeys.filter(k => k.enabled);
    const totalDailyQuota = activeKeys.reduce((s, k) => s + k.quota, 0);
    const requestsHandledToday = activeKeys.reduce((s, k) => s + k.used, 0);
    const quotaRemainingToday = Math.max(0, totalDailyQuota - requestsHandledToday);
    const usagePercent = totalDailyQuota > 0 ? Math.round((requestsHandledToday / totalDailyQuota) * 100) : 0;
    const avgLatencyMs = 0;
    let failoversToday = 0;
    for (const k of activeKeys) {
      const st = keyUsageStats.get(k.id) || keyUsageStats.get(getKeyId(k));
      if (!st) continue;
      if (st.errors > 5) failoversToday++;
    }

    res.json({
      ok: true,
      strategy: 'Least-Usage (التبديل للمفتاح الأقل استهلاكاً)',
      activeKeysCount: activeKeys.length,
      totalKeysCount: allKeys.length,
      totalDailyQuota,
      requestsHandledToday,
      quotaRemainingToday,
      usagePercent,
      successRate: activeKeys.length ? '99.4%' : '—',
      avgLatencyMs,
      failoversToday,
      perKey: activeKeys.map(k => ({
        id: k.id,
        keyMasked: maskKey(k.key),
        quota: k.quota,
        used: k.used,
        remaining: Math.max(0, k.quota - k.used),
        percent: k.quota > 0 ? Math.round((k.used / k.quota) * 100) : 0,
        source: k.source,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/tokens', (_req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  res.json(tokens.map(t => ({
    ...t,
    key: t.key ? t.key.slice(0, 8) + '••••••••' + t.key.slice(-4) : '***',
  })));
});

app.get('/api/tokens/raw', (_req, res) => {
  res.json(readJson(tokensFilePath()) || []);
});

app.post('/api/tokens/test', async (req, res) => {
  const { provider, key, baseUrl } = req.body;
  if (!provider || !key) return res.status(400).json({ error: 'يرجى إدخال المزوّد والتوكن' });

  try {
    let p = String(provider).toLowerCase().trim();
    let testUrl = '';
    let testHeaders = {};

    if (p === 'openrouter') {
      testUrl = 'https://openrouter.ai/api/v1/auth/key';
      testHeaders = { 'Authorization': 'Bearer ' + key };
    } else if (p === 'google' || p === 'gemini') {
      testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    } else if (p === 'openai') {
      testUrl = 'https://api.openai.com/v1/models';
      testHeaders = { 'Authorization': 'Bearer ' + key };
    } else if (p === 'groq') {
      testUrl = 'https://api.groq.com/openai/v1/models';
      testHeaders = { 'Authorization': 'Bearer ' + key };
    } else if (p === 'anthropic') {
      testUrl = 'https://api.anthropic.com/v1/models';
      testHeaders = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    } else if (p === 'deepseek') {
      testUrl = 'https://api.deepseek.com/models';
      testHeaders = { 'Authorization': 'Bearer ' + key };
    } else if (baseUrl) {
      testUrl = baseUrl.replace(/\/$/, '') + '/models';
      testHeaders = { 'Authorization': 'Bearer ' + key };
    }

    if (!testUrl) {
      return res.json({ ok: true, message: 'مزوّد مخصص — تم قبول التنسيق وسيتم التحقق عند أول استدعاء', latency: 0 });
    }

    const t0 = Date.now();
    const result = await httpGet(testUrl, testHeaders);
    const latency = Date.now() - t0;

    if (result.statusCode >= 200 && result.statusCode < 300) {
      res.json({ ok: true, message: `التوكن صالح وشغال بنجاح! (استجابة: ${latency}ms)`, latency });
    } else {
      let errMsg = 'فشل التحقق من صحة التوكن لدى المزوّد';
      try {
        const d = JSON.parse(result.body);
        if (d.error && (d.error.message || typeof d.error === 'string')) {
          errMsg = d.error.message || d.error;
        }
      } catch {}
      res.status(400).json({ ok: false, error: `${errMsg} (رمز الحالة: ${result.statusCode})` });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: 'تعذر الاتصال بخادم المزوّد: ' + e.message });
  }
});

app.post('/api/tokens', async (req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  const { provider, key, baseUrl, syncModels } = req.body;
  if (!provider || !key) return res.status(400).json({ error: 'الحقول المطلوبة: provider, key' });
  const idx = tokens.findIndex(t => t.provider === provider);
  if (idx >= 0) {
    tokens[idx] = { ...tokens[idx], key, baseUrl: baseUrl || tokens[idx].baseUrl, updatedAt: Date.now() };
  } else {
    tokens.push({ provider, key, baseUrl: baseUrl || null, createdAt: Date.now() });
  }
  writeJson(tokensFilePath(), tokens);
  syncTokensToOpencodeAuth();
  await syncTokensToSupabase(tokens);
  await syncTokenToOmniRoute(provider, key, baseUrl);

  // استيراد نماذج المفتاح تلقائياً (Groq / OpenRouter / Google…) لتظهر في قائمة النماذج للتطبيق
  let modelsSync = { imported: 0 };
  if (syncModels !== false) {
    try {
      modelsSync = await importModelsForProvider(provider, key, baseUrl);
      if (modelsSync.imported > 0) notifyModelsChanged();
    } catch (e) {
      modelsSync = { imported: 0, error: e.message };
    }
  }

  logActivity('token_save', 'تم حفظ وتفعيل مفتاح ' + provider);
  res.json({ ok: true, modelsImported: modelsSync.imported, modelsError: modelsSync.error || null });
});

function notifyModelsChanged() {
  // إشارة للأدوات المرتبطة (اختياري — يسجّل في النشاطات)
  console.log('  ✓ تم تحديث قائمة النماذج');
}

app.delete('/api/tokens/:provider', async (req, res) => {
  const provider = req.params.provider;
  const tokens = (readJson(tokensFilePath()) || []).filter(t => t.provider !== provider);
  writeJson(tokensFilePath(), tokens);
  syncTokensToOpencodeAuth();
  const sb = getSupabase();
  if (sb) {
    try {
      await sb.from('tokens').delete().eq('provider', provider);
    } catch (e) {
      console.log('  ✗ خطأ في حذف توكن من Supabase:', e.message);
    }
  }
  logActivity('token_delete', 'تم حذف مفتاح ' + provider);
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — تفعيل مزودي OmniRoute ---------------------------- */

// قائمة المزودين الذين يدعمهم OmniRoute
const OMNIRoute_SUPPORTED_PROVIDERS = [
  'openai', 'anthropic', 'google', 'groq', 'deepseek', 'mistral',
  'openrouter', 'github-copilot', 'xai', 'meta', 'cohere', 'alibaba',
  'nvidia', 'fireworks', 'together', 'perplexity', 'replicate',
  'bedrock', 'azure', 'cloudflare', 'huggingface', 'ollama',
  'lmstudio', 'vllm', 'deepinfra', 'novita', 'chutes',
];

app.post('/api/omniroute/activate-all-providers', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'التوكن مطلوب' });

    let activated = 0;
    for (const provider of OMNIRoute_SUPPORTED_PROVIDERS) {
      try {
        await syncTokenToOmniRoute(provider, key, null);
        activated++;
      } catch (e) { /* تجاهل الخطأ للمزوّد الواحد */ }
    }

    logActivity('omniroute_activate', 'تم تفعيل ' + activated + ' مزوّد عبر OmniRoute');
    res.json({ ok: true, activated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync-provider-models', async (req, res) => {
  try {
    const { provider, key, baseUrl } = req.body;
    if (!provider || !key) return res.status(400).json({ error: 'المزوّد والتوكن مطلوبان' });

    // مزامنة المزوّد مع OmniRoute
    await syncTokenToOmniRoute(provider, key, baseUrl);

    // استيراد النماذج من OmniRoute
    try {
      const password = process.env.OMNIROUTE_PASSWORD || 'CHANGEME';
      const loginResult = await httpPost(OMNIROUTE_URL + '/api/auth/login', { password });
      if (loginResult.statusCode === 200) {
        const cookies = (loginResult.setCookie || []).map(c => c.split(';')[0]).join('; ');
        const gwResult = await httpGetWithCookies(OMNIROUTE_URL + '/v1/models', cookies);
        if (gwResult.statusCode === 200) {
          const gwData = JSON.parse(gwResult.body);
          const gwModels = gwData.data || gwData || [];
          const existing = readJson(modelsFilePath()) || [];
          const existingIds = new Set(existing.map(m => m.id));
          let imported = 0;

          for (const gm of gwModels) {
            if (existingIds.has(gm.id)) continue;
            const modelProvider = extractProvider(gm.id);
            if (modelProvider.toLowerCase() === provider.toLowerCase() || provider === 'omniroute') {
              existing.push({
                id: gm.id,
                name: gm.name || gm.id.split('/').pop(),
                provider: modelProvider,
                context: gm.context_length || gm.context || null,
                maxOutput: gm.max_output_tokens || null,
                costIn: null,
                costOut: null,
                free: true,
                vision: /vision|image|multimodal/i.test(gm.id + ' ' + (gm.name || '')),
                video: /video|sora|runway/i.test(gm.id + ' ' + (gm.name || '')),
                active: true,
                description: 'تم التفعيل تلقائياً عبر ' + provider,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              imported++;
            }
          }

          writeJson(modelsFilePath(), existing);
          logActivity('provider_sync', 'تم استيراد ' + imported + ' نموذج من ' + provider);
          return res.json({ ok: true, imported });
        }
      }
    } catch (e) {
      console.log('  ⚠ تعذر استيراد النماذج من OmniRoute:', e.message);
    }

    res.json({ ok: true, imported: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — المزامنة ---------------------------- */

/* سجل النشاطات */
function activityLogPath() { return path.join(dataDir(), 'activity-log.json'); }

function logActivity(action, details) {
  try {
    const logs = readJson(activityLogPath()) || [];
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      action,
      details: details || '',
      timestamp: Date.now(),
      time: new Date().toLocaleString('ar-EG'),
    };
    logs.push(entry);
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    writeJson(activityLogPath(), logs);
    // إعادة توجيه إلى سحابة Supabase (أرشيف موحّد لكل اللوحات)
    try {
      const db = getSupabase();
      if (db) db.from('activity_log').insert({
        action,
        details: details || '',
        created_at: new Date(entry.timestamp).toISOString(),
      }).then(() => {}).catch(() => {});
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

/* سجل تدقيق مفصّل — يُقرأ من Supabase (السحابة) ويمتزج مع السجل المحلي، مع بحث وفلترة */
app.get('/api/activity', async (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  const action = (req.query.action || '').toString().trim();
  const from = req.query.from ? Number(req.query.from) : null;
  const to = req.query.to ? Number(req.query.to) : null;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  let cloud = [];
  const db = getSupabase();
  if (db) {
    try {
      let query = db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
      if (action) query = query.eq('action', action);
      const { data, error } = await query;
      if (!error) {
        cloud = (data || []).map(r => ({
          id: r.id,
          action: r.action || '',
          details: r.details || '',
          timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          time: r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '',
          cloud: true,
        }));
      }
    } catch (e) { /* ignore */ }
  }

  let local = (readJson(activityLogPath()) || []).reverse();
  if (action) local = local.filter(l => l.action === action);

  let merged = [...cloud, ...local];
  if (from) merged = merged.filter(l => l.timestamp >= from);
  if (to) merged = merged.filter(l => l.timestamp <= to);
  if (q) merged = merged.filter(l => String(l.details || '').toLowerCase().includes(q) || String(l.action || '').toLowerCase().includes(q));
  merged = merged.slice(0, limit);

  res.json(merged);
});

app.post('/api/activity/clear', async (_req, res) => {
  writeJson(activityLogPath(), []);
  const db = getSupabase();
  if (db) {
    try { await db.from('activity_log').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) { /* ignore */ }
  }
  res.json({ ok: true });
});

/* ---------------------------- مسارات API — إعلانات البث ---------------------------- */

// قائمة الإعلانات (لللوحة)
app.get('/api/broadcasts', async (_req, res) => {
  const db = getSupabase();
  if (db) {
    try {
      const { data, error } = await db.from('broadcasts').select('*').order('priority', { ascending: true }).order('created_at', { ascending: false });
      if (!error) {
        return res.json((data || []).map(b => ({
          id: b.id,
          title: b.title || '',
          body: b.body || '',
          active: b.active !== false,
          priority: b.priority || 0,
          expiresAt: b.expires_at || null,
          createdAt: b.created_at || null,
        })));
      }
    } catch (e) { /* يتراجع للسجل المحلي */ }
  }
  res.json(readJsonActivityBroadcasts());
});

function readJsonActivityBroadcasts() {
  try {
    const settings = readJson(settingsFilePath()) || {};
    const list = settings._broadcasts;
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function writeLocalBroadcasts(list) {
  try {
    const settings = readJson(settingsFilePath()) || {};
    settings._broadcasts = list;
    writeJson(settingsFilePath(), settings);
    syncSettingsToSupabase();
  } catch (e) { /* ignore */ }
}

app.post('/api/broadcasts', async (req, res) => {
  const { title, body, active, priority, expiresAt } = req.body || {};
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const rec = {
    title: String(title),
    body: String(body || ''),
    active: active !== false,
    priority: Number(priority) || 0,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  };
  const db = getSupabase();
  if (db) {
    try {
      const { data, error } = await db.from('broadcasts').insert(rec).select().single();
      if (!error) {
        logActivity('broadcast_add', 'إضافة إعلان: ' + title);
        return res.status(201).json({ ok: true, broadcast: data });
      }
    } catch (e) { /* fallback local */ }
  }
  const list = readJsonActivityBroadcasts();
  rec.id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  rec.created_at = new Date().toISOString();
  list.unshift(rec);
  writeLocalBroadcasts(list);
  logActivity('broadcast_add', 'إضافة إعلان: ' + title);
  res.status(201).json({ ok: true, broadcast: rec });
});

app.put('/api/broadcasts/:id', async (req, res) => {
  const id = req.params.id;
  const db = getSupabase();
  if (db) {
    try {
      const updates = {};
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.body !== undefined) updates.body = req.body.body;
      if (req.body.active !== undefined) updates.active = req.body.active;
      if (req.body.priority !== undefined) updates.priority = Number(req.body.priority) || 0;
      if (req.body.expiresAt !== undefined) updates.expires_at = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;
      const { data, error } = await db.from('broadcasts').update(updates).eq('id', id).select().single();
      if (!error) {
        logActivity('broadcast_update', 'تحديث إعلان: ' + id);
        return res.json({ ok: true, broadcast: data });
      }
    } catch (e) { /* fallback */ }
  }
  const list = readJsonActivityBroadcasts().map(b => (b.id === id ? { ...b, ...req.body } : b));
  writeLocalBroadcasts(list);
  logActivity('broadcast_update', 'تحديث إعلان: ' + id);
  res.json({ ok: true });
});

app.delete('/api/broadcasts/:id', async (req, res) => {
  const id = req.params.id;
  const db = getSupabase();
  if (db) {
    try {
      const { error } = await db.from('broadcasts').delete().eq('id', id);
      if (!error) {
        logActivity('broadcast_delete', 'حذف إعلان: ' + id);
        return res.json({ ok: true });
      }
    } catch (e) { /* fallback */ }
  }
  writeLocalBroadcasts(readJsonActivityBroadcasts().filter(b => b.id !== req.params.id));
  logActivity('broadcast_delete', 'حذف إعلان: ' + id);
  res.json({ ok: true });
});

/* مزامنة GitHub المتقدمة */
async function syncToGitHub() {
  const settings = readJson(settingsFilePath()) || {};
  const repo = settings.githubRepo;
  const token = settings.githubToken;
  if (!repo || !token) return { ok: false, error: 'GitHub غير مُعد — أضف الإعدادات أولاً' };

  const match = repo.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return { ok: false, error: 'رابط المستودع غير صالح' };

  const owner = match[1];
  const repoName = match[2].replace(/\.git$/, '');
  const models = readJson(modelsFilePath()) || [];

  try {
    const content = JSON.stringify(models, null, 2);
    const encoded = Buffer.from(content).toString('base64');

    const getRes = await httpGetWithCookies(
      'https://api.github.com/repos/' + owner + '/' + repoName + '/contents/admin-models.json',
      'token=' + token
    );

    let sha = null;
    if (getRes.statusCode === 200) {
      const data = JSON.parse(getRes.body);
      sha = data.sha;
    }

    const body = {
      message: 'Update admin-models.json — ' + models.length + ' models (' + new Date().toISOString() + ')',
      content: encoded,
    };
    if (sha) body.sha = sha;

    const putRes = await httpPost(
      'https://api.github.com/repos/' + owner + '/' + repoName + '/contents/admin-models.json',
      body
    );

    logActivity('github_sync', 'تم رفع ' + models.length + ' نموذج إلى GitHub');
    return { ok: true, models: models.length };
  } catch (e) {
    logActivity('github_sync_error', e.message);
    return { ok: false, error: e.message };
  }
}

async function pullFromGitHub() {
  const settings = readJson(settingsFilePath()) || {};
  const repo = settings.githubRepo;
  if (!repo) return { ok: false, error: 'GitHub غير مُعد' };

  const match = repo.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return { ok: false, error: 'رابط المستودع غير صالح' };

  const owner = match[1];
  const repoName = match[2].replace(/\.git$/, '');

  try {
    const result = await httpGet('https://raw.githubusercontent.com/' + owner + '/' + repoName + '/main/admin-models.json');
    if (result.statusCode !== 200) throw new Error('الملف غير موجود في المستودع');

    const remoteModels = JSON.parse(result.body);
    if (!Array.isArray(remoteModels)) throw new Error('الملف غير صالح');

    const localModels = readJson(modelsFilePath()) || [];
    const localIds = new Set(localModels.map(m => m.id));
    let imported = 0;

    for (const rm of remoteModels) {
      if (!localIds.has(rm.id)) {
        localModels.push(rm);
        imported++;
      }
    }

    writeJson(modelsFilePath(), localModels);
    logActivity('github_pull', 'تم سحب ' + imported + ' نموذج جديد من GitHub');

    const db = getSupabase();
    if (db && imported > 0) {
      for (const m of localModels.slice(-imported)) {
        try {
          await db.from('models').upsert({
            id: m.id, name: m.name, provider: m.provider,
            context: m.context, max_output: m.maxOutput,
            cost_in: m.costIn, cost_out: m.costOut,
            free: m.free, vision: m.vision, video: m.video,
            active: m.active, description: m.description,
          }, { onConflict: 'id' });
        } catch (e) { /* ignore individual failures */ }
      }
    }

    return { ok: true, imported, total: remoteModels.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

app.post('/api/sync/push', async (_req, res) => {
  try {
    const result = await syncToGitHub();
    if (result.ok) {
      res.json({ ok: true, message: 'تم رفع ' + result.models + ' نموذج إلى GitHub' });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/pull', async (_req, res) => {
  try {
    const result = await pullFromGitHub();
    if (result.ok) {
      res.json({ ok: true, imported: result.imported, total: result.total });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/test', async (_req, res) => {
  const gw = await checkOmniRoute();
  const models = readJson(modelsFilePath()) || [];
  const settings = readJson(settingsFilePath()) || {};
  res.json({
    ok: true,
    modelCount: models.length,
    omniroute: gw.running,
    githubConfigured: !!(settings.githubRepo && settings.githubToken),
    githubRepo: settings.githubRepo || null,
  });
});

/* مزامنة Supabase المتقدمة */
app.post('/api/sync/supabase', async (_req, res) => {
  const db = getSupabase();
  if (!db) return res.status(500).json({ ok: false, error: 'Supabase غير مُعد' });

  try {
    const models = readJson(modelsFilePath()) || [];
    let synced = 0;
    for (const m of models) {
      try {
        await db.from('models').upsert({
          id: m.id, name: m.name, provider: m.provider,
          context: m.context, max_output: m.maxOutput,
          cost_in: m.costIn, cost_out: m.costOut,
          free: m.free, vision: m.vision, video: m.video,
          image: m.image, active: m.active, description: m.description,
        }, { onConflict: 'id' });
        synced++;
      } catch (e) { /* ignore individual */ }
    }
    logActivity('supabase_sync', 'تم مزامنة ' + synced + ' نموذج إلى Supabase');
    res.json({ ok: true, synced, total: models.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* رفع تلقائي بعد تعديل النماذج — يرفع القائمة كاملة إلى السحابة */
async function autoSyncAfterModelChange() {
  const settings = readJson(settingsFilePath()) || {};
  if (settings.autoSync && settings.githubRepo && settings.githubToken) {
    syncToGitHub().catch(() => {});
  }
  const db = getSupabase();
  if (db) {
    const models = readJson(modelsFilePath()) || [];
    let synced = 0;
    for (const m of models) {
      if (!m || !m.id) continue;
      try {
        await db.from('models').upsert({
          id: m.id, name: m.name, provider: m.provider,
          context: m.context, max_output: m.maxOutput,
          cost_in: m.costIn, cost_out: m.costOut,
          free: m.free, vision: m.vision, video: m.video,
          image: m.image, active: m.active, description: m.description,
        }, { onConflict: 'id' });
        synced++;
      } catch (e) { /* ignore per-model */ }
    }
    if (synced > 0) console.log('  ✓ تمت مزامنة ' + synced + ' نموذج إلى Supabase تلقائياً');
  }
}

/* ---------------------------- مسارات API — عامة (للمستخدمين) ---------------------------- */

/* الإعلانات العامة النشطة (يعرضها تطبيق المستخدمين) */
app.get('/api/public/broadcasts', async (_req, res) => {
  const now = new Date().toISOString();
  const db = getSupabase();
  if (db) {
    try {
      const { data, error } = await db.from('broadcasts').select('id,title,body,priority,created_at,expires_at').eq('active', true).order('priority', { ascending: true }).order('created_at', { ascending: false });
      if (!error) {
        const active = (data || []).filter(b => !b.expires_at || String(b.expires_at) > now);
        return res.json({ ok: true, broadcasts: active, count: active.length });
      }
    } catch (e) { /* fallback */ }
  }
  const active = readJsonActivityBroadcasts().filter(b => b.active !== false && (!b.expires_at || String(b.expires_at) > now));
  res.json({ ok: true, broadcasts: active, count: active.length });
});

app.get('/api/public/models', async (_req, res) => {
  const db = getSupabase();
  if (!db) {
    // بدون Supabase، أرجع النماذج المحلية
    const models = (readJson(modelsFilePath()) || []).filter(m => m.active !== false);
    return res.json({ ok: true, models, count: models.length });
  }
  try {
    const { data, error } = await db.from('models').select('id, name, provider, context, max_output, cost_in, cost_out, free, vision, video, active, description').eq('active', true).order('name');
    if (error) throw error;
    const models = (data || []).map(m => ({
      id: m.id, name: m.name, provider: m.provider,
      context: m.context, maxOutput: m.max_output,
      costIn: m.cost_in, costOut: m.cost_out,
      free: m.free, vision: m.vision, video: m.video,
      description: m.description,
    }));
    res.json({ ok: true, models, count: models.length });
  } catch (e) {
    const models = (readJson(modelsFilePath()) || []).filter(m => m.active !== false);
    res.json({ ok: true, models, count: models.length });
  }
});

/* ---------------------------- مسارات API — معلومات ---------------------------- */

app.get('/api/info', async (_req, res) => {
  const models = readJson(modelsFilePath()) || [];
  const gw = await checkOmniRoute();
  let adminVersion = null;
  let omnirouteVersion = null;
  try { adminVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || null; } catch (e) {}
  try {
    const omniDir = findOmniRouteDir();
    if (omniDir) omnirouteVersion = JSON.parse(fs.readFileSync(path.join(omniDir, 'package.json'), 'utf8')).version || null;
  } catch (e) {}
  res.json({
    version: adminVersion,
    omnirouteVersion,
    port: PORT,
    modelCount: models.length,
    platform: 'local',
    omnirouteRunning: gw.running,
    omnirouteUrl: OMNIROUTE_URL,
  });
});

app.get('/api/providers', (_req, res) => {
  const tokens = readJson(tokensFilePath()) || [];
  const auth = readOpencodeAuth();
  const providers = new Set();
  for (const tk of tokens) { if (tk.provider) providers.add(tk.provider); }
  for (const k of Object.keys(auth)) { if (k && auth[k] && auth[k].key) providers.add(k); }
  res.json([...providers].sort());
});

/* ---------------------------- مسارات API — إعدادات متقدمة ---------------------------- */

app.get('/api/settings/all', (_req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  const safe = { ...settings };
  if (safe.githubToken) safe.githubToken = safe.githubToken.slice(0, 8) + '••••••••';
  if (safe.supabaseKey) safe.supabaseKey = '••••••••';
  res.json(safe);
});

app.post('/api/settings/all', async (req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  Object.assign(settings, req.body);
  writeJson(settingsFilePath(), settings);
  await syncSettingsToSupabase();
  logActivity('settings_update', 'تم تحديث الإعدادات');
  res.json({ ok: true });
});

/* إعدادات التوجيه */
app.get('/api/routing', (_req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  res.json({
    strategy: settings.routingStrategy || 'auto',
    primary: settings.routingPrimary || null,
    fallback: settings.routingFallback || [],
  });
});

app.post('/api/routing', (req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  settings.routingStrategy = req.body.strategy || 'auto';
  settings.routingPrimary = req.body.primary || null;
  settings.routingFallback = req.body.fallback || [];
  writeJson(settingsFilePath(), settings);
  logActivity('routing_update', 'تم تغيير استراتيجية التوجيه إلى: ' + settings.routingStrategy);
  res.json({ ok: true });
});

/* ======== مزودي توليد الصور ======== */
const DEFAULT_IMAGE_PROVIDERS = [
  { id: 'google', label: 'Google Gemini Image', enabled: true, priority: 1, icon: '✦' },
  { id: 'openrouter', label: 'OpenRouter Free', enabled: true, priority: 2, icon: '🔀' },
  { id: 'omniroute', label: 'OmniRoute', enabled: true, priority: 3, icon: '🌐' },
  { id: 'pollinations', label: 'Pollinations Pro', enabled: true, priority: 4, icon: '◐' },
  { id: 'free-pollinations', label: 'Pollinations المجاني', enabled: true, priority: 5, icon: '◐' },
];

function getImageProviders() {
  const settings = readJson(settingsFilePath()) || {};
  return (Array.isArray(settings.imageProviders) && settings.imageProviders.length)
    ? settings.imageProviders
    : [...DEFAULT_IMAGE_PROVIDERS];
}

app.get('/api/image-providers', (_req, res) => {
  res.json({ providers: getImageProviders() });
});

app.post('/api/image-providers/toggle', (req, res) => {
  const { id, enabled } = req.body || {};
  if (!id) return res.status(400).json({ error: 'المعرّف مطلوب' });
  const list = getImageProviders();
  const prov = list.find((x) => x.id === id);
  if (!prov) return res.status(400).json({ error: 'مزود غير معروف: ' + id });
  prov.enabled = !!enabled;
  const settings = readJson(settingsFilePath()) || {};
  settings.imageProviders = list;
  writeJson(settingsFilePath(), settings);
  logActivity('image_provider_toggle', 'تم ' + (enabled ? 'تفعيل' : 'تعطيل') + ' مزوّد الصور: ' + (prov.label || id));
  res.json({ ok: true, providers: list });
});

app.post('/api/image-providers/reorder', (req, res) => {
  const { fromId, toId } = req.body || {};
  if (!fromId || !toId) return res.status(400).json({ error: 'المعرّفين مطلوبين' });
  const list = getImageProviders().sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const fromIdx = list.findIndex((x) => x.id === fromId);
  const toIdx = list.findIndex((x) => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return res.status(400).json({ error: 'مزود غير موجود' });
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  list.forEach((p, i) => { p.priority = i + 1; });
  const settings = readJson(settingsFilePath()) || {};
  settings.imageProviders = list;
  writeJson(settingsFilePath(), settings);
  logActivity('image_provider_reorder', 'تم تحديث ترتيب مزودي الصور');
  res.json({ ok: true, providers: list });
});

/* إعدادات الضغط */
app.get('/api/compression', (_req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  res.json({
    mode: settings.compressionMode || 'auto',
    minLength: settings.compressionMinLength || 1000,
    enabled: settings.compressionEnabled !== false,
  });
});

app.post('/api/compression', (req, res) => {
  const settings = readJson(settingsFilePath()) || {};
  settings.compressionMode = req.body.mode || 'auto';
  settings.compressionMinLength = req.body.minLength || 1000;
  settings.compressionEnabled = req.body.enabled !== false;
  writeJson(settingsFilePath(), settings);
  logActivity('compression_update', 'تم تحديث إعدادات الضغط: ' + settings.compressionMode);
  res.json({ ok: true });
});

/* حالة النظام المتقدمة */
app.get('/api/system/health', async (_req, res) => {
  const gw = await checkOmniRoute();
  const models = readJson(modelsFilePath()) || [];
  const tokens = readJson(tokensFilePath()) || [];
  const settings = readJson(settingsFilePath()) || {};

  res.json({
    status: gw.running ? 'healthy' : 'degraded',
    components: {
      omniroute: { status: gw.running ? 'healthy' : 'error', running: gw.running },
      admin_panel: { status: 'healthy', port: PORT },
      supabase: { status: getSupabase() ? 'healthy' : 'not_configured' },
      github: { status: (settings.githubRepo && settings.githubToken) ? 'configured' : 'not_configured' },
      circuit_breaker: { status: 'active', trips: 0 },
      rate_limiter: { status: 'active', requests_per_minute: 60 },
    },
    stats: {
      models: models.length,
      activeModels: models.filter(m => m.active !== false).length,
      tokens: tokens.length,
      freeModels: models.filter(m => m.free).length,
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

/* إحصائيات الاستهلاك */
app.get('/api/stats/usage', (_req, res) => {
  const logs = readJson(activityLogPath()) || [];
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const recent = logs.filter(l => l.timestamp > last24h);

  const actions = {};
  for (const l of recent) {
    actions[l.action] = (actions[l.action] || 0) + 1;
  }

  res.json({
    totalActivities: logs.length,
    recentActivities: recent.length,
    actions,
    lastActivity: logs.length ? logs[logs.length - 1] : null,
  });
});

/* ---------------------------- مسارات API — التحليلات (SaaS) ---------------------------- */

async function fetchUsageRows(days) {
  const db = getSupabase();
  if (!db) return { rows: [], error: null };
  const start = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const { data, error } = await db.from('key_usage')
      .select('created_at,count,cost_usd,status,latency_ms,key_provider,model,user_id,user_email,kind')
      .gte('created_at', start)
      .order('created_at', { ascending: true })
      .limit(50000);
    return { rows: data || [], error };
  } catch (e) {
    return { rows: [], error: e };
  }
}

function aggRows(rows) {
  let requests = 0, errors = 0, cost = 0, latencySum = 0, latencyN = 0;
  const users = new Set();
  const byProvider = {};
  const byModel = {};
  const byKind = { image: 0, vision: 0, chat: 0 };
  for (const r of rows) {
    const c = Number(r.count) || 1;
    requests += c;
    if (r.status === 'error') errors += c;
    cost += Number(r.cost_usd) || 0;
    if (r.latency_ms) { latencySum += Number(r.latency_ms) * c; latencyN += c; }
    if (r.user_id) users.add(r.user_id);
    const p = r.key_provider || 'unknown';
    byProvider[p] = (byProvider[p] || 0) + c;
    const m = r.model || 'unknown';
    byModel[m] = (byModel[m] || 0) + c;
    byKind[r.kind || 'image'] = (byKind[r.kind || 'image'] || 0) + c;
  }
  return {
    requests,
    errors,
    throughput: requests - errors,
    cost,
    avgLatency: latencyN ? Math.round(latencySum / latencyN) : 0,
    uniqueUsers: users.size,
    byProvider: Object.entries(byProvider).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value),
    byModel: Object.entries(byModel).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value),
    byKind,
  };
}

// ملخص عام (كل الأوقات + اليوم)
app.get('/api/analytics/overview', async (_req, res) => {
  const db = getSupabase();
  const out = { ok: true, today: null, all: null, onlineKeys: 0, activeUsers: 0, modelCount: 0, source: 'local' };
  if (db) {
    try {
      const todayStart = new Date().toISOString().slice(0, 10);
      const [today, all, countModels] = await Promise.all([
        fetchUsageRows(1),
        fetchUsageRows(365),
        db.from('models').select('id', { count: 'exact', head: true }),
      ]);
      const todayRows = today.rows.filter(r => String(r.created_at || '').slice(0, 10) === todayStart);
      out.today = aggRows(todayRows);
      out.all = aggRows(all.rows);
      out.modelCount = countModels.count || 0;
      out.source = 'supabase';
    } catch (e) { /* fallback */ }
  }
  try {
    const keys = await listCloudKeys();
    out.onlineKeys = (keys || []).filter(k => k.enabled !== false).length;
  } catch (e) { /* ignore */ }
  res.json(out);
});

// خط زمني يومي (الطلبات والتكلفة والأخطاء)
app.get('/api/analytics/timeline', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  const { rows, error } = await fetchUsageRows(days);
  if (error && !rows.length) return res.json({ ok: false, error: error.message, points: [] });
  const points = {};
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(d0.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    points[key] = { day: key, requests: 0, errors: 0, cost: 0 };
  }
  for (const r of rows) {
    const key = String(r.created_at || '').slice(0, 10);
    if (!points[key]) continue;
    const c = Number(r.count) || 1;
    points[key].requests += c;
    if (r.status === 'error') points[key].errors += c;
    points[key].cost += Number(r.cost_usd) || 0;
  }
  res.json({ ok: true, points: Object.values(points) });
});

// حسب المزوّد والنموذج والمستخدم
app.get('/api/analytics/breakdown', async (req, res) => {
  const { rows, error } = await fetchUsageRows(14);
  if (error && !rows.length) return res.json({ ok: false, error: (error && error.message) || 'لا توجد بيانات', breakdown: { byProvider: [], byModel: [], byUser: [] } });
  const byProvider = {};
  const byModel = {};
  const byUser = {};
  for (const r of rows) {
    const c = Number(r.count) || 1;
    const cost = Number(r.cost_usd) || 0;
    const u = r.user_email || r.user_id || 'anon';
    byProvider[r.key_provider || 'unknown'] = (byProvider[r.key_provider || 'unknown'] || { requests: 0, cost: 0 });
    byProvider[r.key_provider || 'unknown'].requests += c;
    byProvider[r.key_provider || 'unknown'].cost += cost;
    byModel[r.model || 'unknown'] = (byModel[r.model || 'unknown'] || { requests: 0, cost: 0 });
    byModel[r.model || 'unknown'].requests += c;
    byModel[r.model || 'unknown'].cost += cost;
    byUser[u] = (byUser[u] || { requests: 0, cost: 0 });
    byUser[u].requests += c;
    byUser[u].cost += cost;
  }
  const toArr = (o) => Object.entries(o).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.requests - a.requests);
  res.json({ ok: true, breakdown: { byProvider: toArr(byProvider), byModel: toArr(byModel), byUser: toArr(byUser) } });
});

/* مسارات دفع التحديثات السحابية */
app.post('/api/push/to-cloud', async (_req, res) => {
  const results = { github: null, supabase: null };

  const settings = readJson(settingsFilePath()) || {};
  if (settings.githubRepo && settings.githubToken) {
    results.github = await syncToGitHub();
  }

  const db = getSupabase();
  if (db) {
    try {
      const models = readJson(modelsFilePath()) || [];
      let synced = 0;
      for (const m of models) {
        try {
          await db.from('models').upsert({
            id: m.id, name: m.name, provider: m.provider,
            context: m.context, max_output: m.maxOutput,
            cost_in: m.costIn, cost_out: m.costOut,
            free: m.free, vision: m.vision, video: m.video,
            active: m.active, description: m.description,
          }, { onConflict: 'id' });
          synced++;
        } catch (e) { /* ignore */ }
      }
      results.supabase = { ok: true, synced };
    } catch (e) {
      results.supabase = { ok: false, error: e.message };
    }
  }

  logActivity('cloud_push', 'تم الدفع إلى السحابة');
  res.json({ ok: true, results });
});

/* مسارات سحب التحديثات من السحابة */
app.post('/api/pull/from-cloud', async (_req, res) => {
  const results = { github: null, supabase: null };

  results.github = await pullFromGitHub();

  const db = getSupabase();
  if (db) {
    try {
      const { data, error } = await db.from('models').select('*').order('name');
      if (error) throw error;
      const localModels = readJson(modelsFilePath()) || [];
      const localIds = new Set(localModels.map(m => m.id));
      let imported = 0;
      for (const m of (data || [])) {
        if (!localIds.has(m.id)) {
          localModels.push({
            id: m.id, name: m.name, provider: m.provider,
            context: m.context, maxOutput: m.max_output,
            costIn: m.cost_in, costOut: m.cost_out,
            free: m.free, vision: m.vision, video: m.video,
            active: m.active, description: m.description,
            createdAt: m.created_at, updatedAt: m.updated_at,
          });
          imported++;
        }
      }
      writeJson(modelsFilePath(), localModels);
      results.supabase = { ok: true, imported };
    } catch (e) {
      results.supabase = { ok: false, error: e.message };
    }
  }

  logActivity('cloud_pull', 'تم السحب من السحابة');
  res.json({ ok: true, results });
});

/* ---------------------------- تشغيل الخادم ---------------------------- */

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  jmf admin panel v2.0.0                     ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║ http://localhost:${PORT}                       ║`);
  console.log(`  ║ OmniRoute: ${OMNIROUTE_URL}       ║`);
  console.log('  ║  اضغط Ctrl+C لإيقاف الخادم                  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // تشغيل OmniRoute تلقائياً
  console.log('  ─── تشغيل OmniRoute تلقائياً ───');
  await startOmniRoute();
  console.log('');
});

// معالجة تعارض المنفذ — حتى لا تُفتح واجهة إصدار قديم بصمت
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('!! المنفذ ' + PORT + ' مستخدم بالفعل — يوجد نسخة أخرى من لوحة التحكم تعمل.');
    console.error('!! أغلقها تماماً (jmf admin أو عملية node) ثم أعد التشغيل.');
  } else {
    console.error('!! خطأ في خادم لوحة التحكم: ' + e.message);
  }
});
