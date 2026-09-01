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
    const { id, name, provider, context, maxOutput, costIn, costOut, free, vision, video, active, description, usage } = req.body;
    if (!id || !name || !provider) {
      return res.status(400).json({ error: 'الحقول المطلوبة: id, name, provider' });
    }
    const { data: existing } = await db.from('models').select('id').eq('id', id).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'النموذج موجود بالفعل' });
    }
    const { data, error } = await db.from('models').insert({
      id, name, provider,
      context: context || null,
      max_output: maxOutput || null,
      cost_in: costIn || null,
      cost_out: costOut || null,
      free: !!free,
      vision: !!vision,
      video: !!video,
      usage: usage || 'text',
      active: active !== false,
      description: description || '',
    }).select().single();
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
    if (req.body.usage !== undefined) updates.usage = req.body.usage;
    if (req.body.active !== undefined) updates.active = req.body.active;
    if (req.body.description !== undefined) updates.description = req.body.description;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await db.from('models').update(updates).eq('id', req.params.id).select().single();
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
