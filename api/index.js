/* ============================================================
   jmf admin panel — Vercel Serverless Function
   يستخدم Supabase كقاعدة بيانات
   ============================================================ */

'use strict';

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------------------------- Supabase Config ---------------------------- */

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase غير مُعدّ — أضف SUPABASE_URL و SUPABASE_SERVICE_KEY في Vercel Environment Variables');
  return createClient(url, key, { auth: { persistSession: false } });
}

/* ---------------------------- مسارات API — معلومات ---------------------------- */

app.get('/api/info', async (_req, res) => {
  try {
    const db = getSupabase();
    const { count: modelCount } = await db.from('models').select('*', { count: 'exact', head: true });
    const { count: tokenCount } = await db.from('tokens').select('*', { count: 'exact', head: true });
    res.json({
      version: '1.0.0',
      port: null,
      modelCount: modelCount || 0,
      tokenCount: tokenCount || 0,
      platform: 'vercel+supabase',
      githubConfigured: false,
    });
  } catch (e) {
    res.json({ version: '1.0.0', port: null, modelCount: 0, tokenCount: 0, platform: 'vercel+supabase', githubConfigured: false });
  }
});

/* ---------------------------- مسارات API — النماذج ---------------------------- */

app.get('/api/models', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('models').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const models = (data || []).map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      context: m.context,
      maxOutput: m.max_output,
      costIn: m.cost_in,
      costOut: m.cost_out,
      free: m.free,
      vision: m.vision,
      video: m.video,
      usage: m.usage || 'text',
      active: m.active,
      visible: m.visible !== false,
      keyId: m.key_id || null,
      trialDays: m.trial_days || null,
      trialRequests: m.trial_requests || null,
      requestLimit: m.request_limit || null,
      description: m.description,
      createdAt: m.created_at ? new Date(m.created_at).getTime() : null,
      updatedAt: m.updated_at ? new Date(m.updated_at).getTime() : null,
    }));
    res.json(models);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/models', async (req, res) => {
  try {
    const db = getSupabase();
    const { id, name, provider, context, maxOutput, costIn, costOut, free, vision, video, active, description, usage, keyId, visible, trialDays, trialRequests, requestLimit } = req.body;
    if (!id || !name || !provider) {
      return res.status(400).json({ error: 'الحقول المطلوبة: id, name, provider' });
    }
    const { data: existing } = await db.from('models').select('id').eq('id', id).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'النموذج موجود بالفعل' });
    }
    const full = {
      id, name, provider,
      context: context || null,
      max_output: maxOutput || null,
      cost_in: costIn || null,
      cost_out: costOut || null,
      free: !!free,
      vision: !!vision,
      video: !!video,
      image: !!(usage === 'image' || req.body.image),
      active: active !== false,
      description: description || '',
    };
    // Try with extended columns (usage, visible, key_id, etc.) — may not exist yet
    try {
      full.usage = usage || 'text';
      full.visible = visible !== false;
      full.key_id = keyId || null;
      full.trial_days = trialDays || null;
      full.trial_requests = trialRequests || null;
      full.request_limit = requestLimit || null;
    } catch (_) {}
    let { data, error } = await db.from('models').insert(full).select().single();
    if (error && String(error.message || '').includes('column')) {
      // Retry with basic columns only
      const basic = { id, name, provider, context: context || null, max_output: maxOutput || null, cost_in: costIn || null, cost_out: costOut || null, free: !!free, vision: !!vision, video: !!video, image: !!(usage === 'image' || req.body.image), active: active !== false, description: description || '' };
      ({ data, error } = await db.from('models').insert(basic).select().single());
    }
    if (error) throw error;
    res.json({ ok: true, model: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/models/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.provider !== undefined) updates.provider = req.body.provider;
    if (req.body.context !== undefined) updates.context = req.body.context;
    if (req.body.maxOutput !== undefined) updates.max_output = req.body.maxOutput;
    if (req.body.costIn !== undefined) updates.cost_in = req.body.costIn;
    if (req.body.costOut !== undefined) updates.cost_out = req.body.costOut;
    if (req.body.free !== undefined) updates.free = req.body.free;
    if (req.body.vision !== undefined) updates.vision = req.body.vision;
    if (req.body.video !== undefined) updates.video = req.body.video;
    if (req.body.active !== undefined) updates.active = req.body.active;
    if (req.body.image !== undefined) updates.image = req.body.image;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.usage !== undefined) updates.usage = req.body.usage;
    if (req.body.visible !== undefined) updates.visible = req.body.visible;
    if (req.body.keyId !== undefined) updates.key_id = req.body.keyId;
    if (req.body.trialDays !== undefined) updates.trial_days = req.body.trialDays;
    if (req.body.trialRequests !== undefined) updates.trial_requests = req.body.trialRequests;
    if (req.body.requestLimit !== undefined) updates.request_limit = req.body.requestLimit;
    updates.updated_at = new Date().toISOString();
    let { data, error } = await db.from('models').update(updates).eq('id', req.params.id).select().single();
    if (error && String(error.message || '').includes('column')) {
      // Retry with only basic columns
      const basic = {};
      if (updates.name !== undefined) basic.name = updates.name;
      if (updates.provider !== undefined) basic.provider = updates.provider;
      if (updates.context !== undefined) basic.context = updates.context;
      if (updates.max_output !== undefined) basic.max_output = updates.max_output;
      if (updates.cost_in !== undefined) basic.cost_in = updates.cost_in;
      if (updates.cost_out !== undefined) basic.cost_out = updates.cost_out;
      if (updates.free !== undefined) basic.free = updates.free;
      if (updates.vision !== undefined) basic.vision = updates.vision;
      if (updates.video !== undefined) basic.video = updates.video;
      if (updates.active !== undefined) basic.active = updates.active;
      if (updates.image !== undefined) basic.image = updates.image;
      if (updates.description !== undefined) basic.description = updates.description;
      basic.updated_at = updates.updated_at;
      ({ data, error } = await db.from('models').update(basic).eq('id', req.params.id).select().single());
    }
    if (error) throw error;
    res.json({ ok: true, model: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/models/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const { error } = await db.from('models').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — التوكنات ---------------------------- */

app.get('/api/tokens', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('tokens').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const safe = (data || []).map(t => ({
      provider: t.provider,
      key: t.key ? t.key.slice(0, 8) + '••••••••' + t.key.slice(-4) : '***',
      baseUrl: t.base_url,
      createdAt: t.created_at ? new Date(t.created_at).getTime() : null,
    }));
    res.json(safe);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/tokens/raw', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('tokens').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const tokens = (data || []).map(t => ({
      provider: t.provider,
      key: t.key,
      baseUrl: t.base_url,
      createdAt: t.created_at ? new Date(t.created_at).getTime() : null,
    }));
    res.json(tokens);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/tokens', async (req, res) => {
  try {
    const db = getSupabase();
    const { provider, key, baseUrl } = req.body;
    if (!provider || !key) return res.status(400).json({ error: 'الحقول المطلوبة: provider, key' });
    const { data: existing } = await db.from('tokens').select('provider').eq('provider', provider).maybeSingle();
    if (existing) {
      const { error } = await db.from('tokens').update({ key, base_url: baseUrl || null, updated_at: new Date().toISOString() }).eq('provider', provider);
      if (error) throw error;
    } else {
      const { error } = await db.from('tokens').insert({ provider, key, base_url: baseUrl || null });
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tokens/:provider', async (req, res) => {
  try {
    const db = getSupabase();
    const { error } = await db.from('tokens').delete().eq('provider', req.params.provider);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — الإعدادات ---------------------------- */

app.get('/api/settings', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data } = await db.from('settings').select('*').eq('key', 'github').maybeSingle();
    res.json({
      githubRepo: data?.value?.repo || '',
      githubToken: data?.value?.token ? '••••••••' : '',
      port: null,
    });
  } catch (e) {
    res.json({ githubRepo: '', githubToken: '', port: null });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const db = getSupabase();
    const { data: existing } = await db.from('settings').select('value').eq('key', 'github').maybeSingle();
    const current = existing?.value || { repo: '', token: '' };
    if (req.body.githubRepo !== undefined) current.repo = req.body.githubRepo;
    if (req.body.githubToken !== undefined) current.token = req.body.githubToken;
    const { error } = await db.from('settings').upsert({ key: 'github', value: current, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — المزوّدين ---------------------------- */

app.get('/api/providers', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('tokens').select('provider');
    if (error) throw error;
    const providers = (data || []).map(t => t.provider).filter(Boolean);
    res.json([...new Set(providers)].sort());
  } catch (e) {
    res.json([]);
  }
});

/* ---------------------------- مسارات API — بوابة OmniRoute ---------------------------- */

app.get('/api/gateway/status', async (_req, res) => {
  res.json({ running: false, message: 'Gateway status غير متاح على Vercel' });
});

/* ---------------------------- مسارات API — المزامنة ---------------------------- */

app.post('/api/sync/push', async (_req, res) => {
  res.json({ ok: true, message: 'المزامنة تلقائية مع Supabase — لا حاجة لـ push يدوي' });
});

app.post('/api/sync/pull', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('models').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, models: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sync/test', async (_req, res) => {
  try {
    const db = getSupabase();
    const { count, error } = await db.from('models').select('*', { count: 'exact', head: true });
    if (error) throw error;
    res.json({ ok: true, modelCount: count || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — OmniRoute ---------------------------- */

app.post('/api/gateway/import-free', async (_req, res) => {
  res.status(501).json({ error: 'استيراد OmniRoute غير متاح على Vercel — استخدم النسخة المحلية أو زر التحديث من التطبيق' });
});

/* ---------------------------- مسارات API — عامة (بدون مصادقة) ---------------------------- */

app.get('/api/public/models', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('models').select('id, name, provider, context, max_output, cost_in, cost_out, free, vision, video, image, active, description').eq('active', true).order('name');
    if (error) throw error;
    const models = (data || []).map(m => ({
      id: m.id, name: m.name, provider: m.provider,
      context: m.context, maxOutput: m.max_output,
      costIn: m.cost_in, costOut: m.cost_out,
      free: m.free, vision: m.vision, video: m.video,
      image: !!m.image,
      visible: true,
      description: m.description,
    }));
    res.json({ ok: true, models, count: models.length });
  } catch (e) {
    res.json({ ok: true, models: [], count: 0 });
  }
});

/* ---------------------------- مسارات API — إعدادات شاملة (__all__) ---------------------------- */

app.get('/api/settings/all', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('settings').select('value').eq('key', '__all__').maybeSingle();
    if (error) throw error;
    res.json(data?.value || {});
  } catch (e) {
    res.json({});
  }
});

app.post('/api/settings/all', async (req, res) => {
  try {
    const db = getSupabase();
    const value = req.body || {};
    const { error } = await db.from('settings').upsert({ key: '__all__', value, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- مسارات API — إعلانات البث ---------------------------- */

app.get('/api/broadcasts', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('broadcasts').select('*').order('priority', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(b => ({ id: b.id, title: b.title || '', body: b.body || '', active: b.active !== false, priority: b.priority || 0, expiresAt: b.expires_at || null, createdAt: b.created_at || null })));
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/broadcasts', async (req, res) => {
  const { title, body, active, priority, expiresAt } = req.body || {};
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  try {
    const db = getSupabase();
    const rec = { title: String(title), body: String(body || ''), active: active !== false, priority: Number(priority) || 0, expires_at: expiresAt ? new Date(expiresAt).toISOString() : null };
    const { data, error } = await db.from('broadcasts').insert(rec).select().single();
    if (error) throw error;
    res.status(201).json({ ok: true, broadcast: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/broadcasts/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const db = getSupabase();
    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.body !== undefined) updates.body = req.body.body;
    if (req.body.active !== undefined) updates.active = req.body.active;
    if (req.body.priority !== undefined) updates.priority = Number(req.body.priority) || 0;
    if (req.body.expiresAt !== undefined) updates.expires_at = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;
    const { error } = await db.from('broadcasts').update(updates).eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/broadcasts/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const { error } = await db.from('broadcasts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/public/broadcasts', async (_req, res) => {
  const now = new Date().toISOString();
  try {
    const db = getSupabase();
    const { data, error } = await db.from('broadcasts').select('id,title,body,priority,created_at,expires_at').eq('active', true).order('priority', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw error;
    const active = (data || []).filter(b => !b.expires_at || String(b.expires_at) > now);
    res.json({ ok: true, broadcasts: active, count: active.length });
  } catch (e) {
    res.json({ ok: true, broadcasts: [], count: 0 });
  }
});

/* ---------------------------- مسارات API — التحليلات ---------------------------- */

async function fetchUsageRows(days) {
  const db = getSupabase();
  const start = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const { data, error } = await db.from('key_usage').select('created_at,count,cost_usd,status,latency_ms,key_provider,model,user_id,user_email,kind').gte('created_at', start).order('created_at', { ascending: true }).limit(50000);
    return { rows: data || [], error };
  } catch (e) { return { rows: [], error: e }; }
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
    byProvider[r.key_provider || 'unknown'] = (byProvider[r.key_provider || 'unknown'] || 0) + c;
    byModel[r.model || 'unknown'] = (byModel[r.model || 'unknown'] || 0) + c;
    byKind[r.kind || 'image'] = (byKind[r.kind || 'image'] || 0) + c;
  }
  return { requests, errors, cost, avgLatency: latencyN ? Math.round(latencySum / latencyN) : 0, uniqueUsers: users.size, byProvider: Object.entries(byProvider).map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value - a.value), byModel: Object.entries(byModel).map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value - a.value), byKind };
}

app.get('/api/analytics/overview', async (_req, res) => {
  try {
    const db = getSupabase();
    const todayStart = new Date().toISOString().slice(0, 10);
    const [todayAll, allAll, countModels] = await Promise.all([fetchUsageRows(1), fetchUsageRows(365), db.from('models').select('id', { count: 'exact', head: true })]);
    const today = aggRows(todayAll.rows.filter(r => String(r.created_at || '').slice(0, 10) === todayStart));
    const all = aggRows(allAll.rows);
    res.json({ ok: true, today, all, modelCount: countModels.count || 0, source: 'supabase' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/analytics/timeline', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  const { rows, error } = await fetchUsageRows(days);
  if (error && !rows.length) return res.status(500).json({ ok: false, error: (error && error.message) });
  const points = {};
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) { const d = new Date(d0.getTime() - i * 86400000); const k = d.toISOString().slice(0, 10); points[k] = { day: k, requests: 0, errors: 0, cost: 0 }; }
  for (const r of rows) { const k = String(r.created_at || '').slice(0, 10); if (!points[k]) continue; const c = Number(r.count) || 1; points[k].requests += c; if (r.status === 'error') points[k].errors += c; points[k].cost += Number(r.cost_usd) || 0; }
  res.json({ ok: true, points: Object.values(points) });
});

app.get('/api/analytics/breakdown', async (_req, res) => {
  const { rows, error } = await fetchUsageRows(14);
  if (error && !rows.length) return res.json({ ok: false, breakdown: { byProvider: [], byModel: [], byUser: [] } });
  const byProvider = {}; const byModel = {}; const byUser = {};
  for (const r of rows) { const c = Number(r.count) || 1; const cost = Number(r.cost_usd) || 0; const u = r.user_email || r.user_id || 'anon'; byProvider[r.key_provider || 'unknown'] = (byProvider[r.key_provider || 'unknown'] || { requests: 0, cost: 0 }); byProvider[r.key_provider || 'unknown'].requests += c; byProvider[r.key_provider || 'unknown'].cost += cost; byModel[r.model || 'unknown'] = (byModel[r.model || 'unknown'] || { requests: 0, cost: 0 }); byModel[r.model || 'unknown'].requests += c; byModel[r.model || 'unknown'].cost += cost; byUser[u] = (byUser[u] || { requests: 0, cost: 0 }); byUser[u].requests += c; byUser[u].cost += cost; }
  const toArr = (o) => Object.entries(o).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.requests - a.requests);
  res.json({ ok: true, breakdown: { byProvider: toArr(byProvider), byModel: toArr(byModel), byUser: toArr(byUser) } });
});

/* ---------------------------- مسارات API — صحة المفاتيح ---------------------------- */

app.get('/api/health/keys', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('api_keys').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const statuses = (data || []).map(k => {
      const usedToday = k.last_reset && String(k.last_reset).slice(0, 10) === today ? (Number(k.used_today) || 0) : 0;
      const quota = Number(k.quota_daily) || 1500;
      return { id: k.id, provider: k.provider || 'google', label: k.label || '', enabled: k.enabled !== false, usedToday, quotaDaily: quota, remaining: Math.max(quota - usedToday, 0), health: !k.enabled ? 'disabled' : (quota - usedToday <= 0 ? 'exhausted' : (quota - usedToday <= quota * 0.2 ? 'low' : 'ok')) };
    });
    res.json({ ok: true, keys: statuses, summary: { total: statuses.length, ok: statuses.filter(k => k.health === 'ok').length, low: statuses.filter(k => k.health === 'low').length, exhausted: statuses.filter(k => k.health === 'exhausted').length, disabled: statuses.filter(k => k.health === 'disabled').length } });
  } catch (e) {
    res.json({ ok: true, keys: [], summary: { total: 0, ok: 0, low: 0, exhausted: 0, disabled: 0 } });
  }
});

/* ---------------------------- مسارات API — صحة المزوّدين ---------------------------- */

function md5Short(str) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < String(str).length; i++) {
    const ch = String(str).charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16).slice(0, 8) + (h2 >>> 0).toString(16).slice(0, 4);
}

function normalizeProvider(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'gemini' || s === 'google') return 'google';
  return s;
}

function maskKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

function getKeyId(k) {
  if (!k) return '';
  const s = String(k.key || k.id || k);
  return s.slice(0, 10) + '_' + md5Short(s).slice(-4);
}

// قائمة المزوّدين بصحة موجزة (المزوّدون الموجودون فعلاً فقط)
app.get('/api/health/providers', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('api_keys').select('*');
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const byProv = {};
    for (const k of (data || [])) {
      const p = normalizeProvider(k.provider || 'google');
      if (!byProv[p]) byProv[p] = { provider: p, keys: 0, enabledKeys: 0, totalQuota: 0, usedToday: 0, errors: 0, status: 'ok', lastActive: null };
      const used = k.last_reset && String(k.last_reset).slice(0, 10) === today ? (Number(k.used_today) || 0) : 0;
      const quota = Number(k.quota_daily) || 1500;
      byProv[p].keys++;
      if (k.enabled !== false) byProv[p].enabledKeys++;
      byProv[p].totalQuota += quota;
      byProv[p].usedToday += used;
      if (used >= quota) byProv[p].status = 'exhausted';
      else if (used >= quota * 0.8) byProv[p].status = 'low';
    }
    res.json({ ok: true, providers: Object.values(byProv) });
  } catch (e) {
    res.json({ ok: true, providers: [] });
  }
});

// مجمّع المفاتيح الموحّد (صفحة «المفاتيح») — من جدول api_keys في Supabase
app.get('/api/keys/pool', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('api_keys').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const merged = (data || []).map(k => {
      const used = k.last_reset && String(k.last_reset).slice(0, 10) === today ? (Number(k.used_today) || 0) : 0;
      const quota = Number(k.quota_daily) || 1500;
      const remaining = Math.max(quota - used, 0);
      return {
        id: k.id || getKeyId(k),
        provider: normalizeProvider(k.provider || 'google'),
        baseUrl: k.base_url || '',
        label: k.label || '',
        keyMasked: maskKey(k.key),
        key: k.key,
        source: 'cloud',
        status: k.enabled === false ? 'disabled' : (remaining <= 0 ? 'exhausted' : 'active'),
        requests: used,
        errors: Number(k.errors) || 0,
        latency: Number(k.latency_ms) || 0,
        quotaDaily: quota,
        usedToday: used,
        quotaRemaining: remaining,
        enabled: k.enabled !== false,
        lastReset: k.last_reset || null,
        createdAt: k.created_at || Date.now(),
      };
    });
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

// إضافة مفتاح
app.post('/api/keys/pool', async (req, res) => {
  try {
    const db = getSupabase();
    const provider = normalizeProvider(req.body.provider || 'google');
    const key = String(req.body.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'المفتاح مطلوب' });
    const rec = {
      provider,
      key,
      label: String(req.body.label || '').trim(),
      quota_daily: Number(req.body.quotaDaily) || 1500,
      base_url: req.body.baseUrl || null,
      enabled: req.body.enabled !== false,
      used_today: 0,
      last_reset: new Date().toISOString().slice(0, 10),
    };
    const { data, error } = await db.from('api_keys').insert(rec).select().single();
    if (error) throw error;
    res.json({ ok: true, added: [{ id: data.id, label: data.label, keyMasked: maskKey(data.key) }] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// تبديل تفعيل مفتاح
app.patch('/api/keys/pool/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const updates = {};
    if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled;
    if (req.body.quota_daily !== undefined) updates.quota_daily = Number(req.body.quota_daily);
    if (req.body.label !== undefined) updates.label = req.body.label;
    updates.updated_at = new Date().toISOString();
    const { error } = await db.from('api_keys').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// إعادة ضبط الكوتة اليومية لمفتاح
app.post('/api/keys/pool/:id/reset', async (req, res) => {
  try {
    const db = getSupabase();
    const { error } = await db.from('api_keys').update({ used_today: 0, last_reset: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// حذف مفتاح
app.delete('/api/keys/pool/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const { error } = await db.from('api_keys').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// صحة النظام
app.get('/api/system/health', async (_req, res) => {
  try {
    const db = getSupabase();
    const { count: modelCount } = await db.from('models').select('*', { count: 'exact', head: true });
    const { count: keyCount } = await db.from('api_keys').select('*', { count: 'exact', head: true });
    res.json({ ok: true, status: 'healthy', supabase: true, modelCount: modelCount || 0, keyCount: keyCount || 0, platform: 'vercel+supabase' });
  } catch (e) {
    res.json({ ok: false, status: 'degraded', supabase: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — المستخدمون ---------------------------- */

app.get('/api/users/stats', async (_req, res) => {
  try {
    const db = getSupabase();
    const usersByEmail = new Map();
    const { data: profiles, error: pErr } = await db.from('user_profiles').select('*').order('updated_at', { ascending: false }).limit(1000);
    if (!pErr) {
      for (const p of (profiles || [])) {
        usersByEmail.set(String(p.email || p.user_id || '').toLowerCase(), {
          id: p.user_id,
          email: p.email || p.user_id,
          name: (p.email || p.user_id || '').split('@')[0],
          plan: p.plan || 'free',
          imagesTotal: Number(p.images_total) || 0,
          imagesToday: Number(p.images_today) || 0,
          visionToday: Number(p.vision_today) || 0,
          lastReset: p.last_reset || null,
          lastActive: p.updated_at || p.created_at || null,
          createdAt: p.created_at || null,
        });
      }
    }
    const { data: usage, error: uErr } = await db.from('key_usage').select('user_id,user_email,count,kind,cost_usd,created_at,status').not('user_id', 'is', null).order('created_at', { ascending: false }).limit(5000);
    if (!uErr) {
      for (const r of (usage || [])) {
        const email = String(r.user_email || '').toLowerCase();
        const key = email || String(r.user_id || 'anon');
        if (!usersByEmail.has(key)) {
          usersByEmail.set(key, {
            id: r.user_id, email: r.user_email || r.user_id, name: (r.user_email || r.user_id || '').split('@')[0], plan: 'free', imagesTotal: 0, imagesToday: 0, visionToday: 0, lastActive: r.created_at, createdAt: r.created_at,
          });
        }
        const u = usersByEmail.get(key);
        const c = Number(r.count) || 1;
        u.totalRequests = (u.totalRequests || 0) + c;
        u.totalCost = (u.totalCost || 0) + (Number(r.cost_usd) || 0);
        if (r.kind === 'image') u.imagesTotal = (u.imagesTotal || 0) + c;
        if (r.status === 'error') u.errors = (u.errors || 0) + c;
        if (!u.lastActive || String(r.created_at || '') > String(u.lastActive || '')) u.lastActive = r.created_at;
      }
    }
    let users = [...usersByEmail.values()].map(u => ({ ...u, totalRequests: u.totalRequests || 0, totalCost: numFmt(u.totalCost) }));
    users = users.sort((a, b) => (b.totalRequests || 0) - (a.totalRequests || 0));
    res.json({ ok: true, users, source: profiles && profiles.length ? 'supabase' : 'usage' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function numFmt(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/* ---------------------------- مسارات API — الباقات والاشتراكات ---------------------------- */

const DEFAULT_PLANS = [{ id: 'free', name: 'مجاني', price: 0, cycle: 'month', imageQuota: 50, vision: true, features: ['صور محدودة يومياً'] }, { id: 'pro', name: 'احترافي', price: 9.99, cycle: 'month', imageQuota: 500, vision: true, features: ['500 صورة شهرياً'] }, { id: 'premium', name: 'مميز', price: 24.99, cycle: 'month', imageQuota: 5000, vision: true, features: ['5000 صورة شهرياً'] }];

app.get('/api/plans', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data } = await db.from('settings').select('value').eq('key', '__plans__').maybeSingle();
    res.json({ ok: true, plans: data?.value || DEFAULT_PLANS });
  } catch (e) {
    res.json({ ok: true, plans: DEFAULT_PLANS });
  }
});

app.post('/api/plans', async (req, res) => {
  const plans = req.body?.plans || (Array.isArray(req.body) ? req.body : null);
  if (!plans) return res.status(400).json({ error: 'قائمة الباقات مطلوبة' });
  try {
    const db = getSupabase();
    await db.from('settings').upsert({ key: '__plans__', value: plans, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/subscriptions', async (_req, res) => {
  try {
    const db = getSupabase();
    const { data, error } = await db.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ ok: true, subscriptions: (data || []).map(s => ({ id: s.id, userId: s.user_id, plan: s.plan, status: s.status, startsAt: s.starts_at, expiresAt: s.expires_at, features: s.features || {}, createdAt: s.created_at })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/subscriptions', async (req, res) => {
  const { userId, email, plan, status, expiresAt } = req.body || {};
  if (!userId && !email) return res.status(400).json({ error: 'معرّف المستخدم مطلوب' });
  try {
    const db = getSupabase();
    const sub = { user_id: userId || email, plan: plan || 'free', status: status || 'active', expires_at: expiresAt ? new Date(expiresAt).toISOString() : null, updated_at: new Date().toISOString() };
    const { data: existing } = await db.from('subscriptions').select('id').eq('user_id', sub.user_id).maybeSingle();
    if (existing) {
      await db.from('subscriptions').update(sub).eq('id', existing.id);
    } else {
      await db.from('subscriptions').insert(sub);
    }
    await db.from('user_profiles').upsert({ user_id: sub.user_id, email: email || '', plan: sub.plan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------------- مسارات API — سجل التدقيق ---------------------------- */

app.get('/api/activity', async (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  const action = (req.query.action || '').toString().trim();
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  try {
    const db = getSupabase();
    let query = db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (action) query = query.eq('action', action);
    const { data, error } = await query;
    if (error) throw error;
    let rows = (data || []).map(r => ({ id: r.id, action: r.action || '', details: r.details || '', timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(), time: r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '' }));
    if (q) rows = rows.filter(l => String(l.details).toLowerCase().includes(q) || String(l.action).toLowerCase().includes(q));
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/activity/clear', async (_req, res) => {
  try {
    const db = getSupabase();
    await db.from('activity_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------- Export ---------------------------- */

module.exports = app;
