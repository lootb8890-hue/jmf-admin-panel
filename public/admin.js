/* ============================================================
   jmf admin panel — واجهة لوحة التحكم المستقلة
   تتواصل مع الخادم عبر REST API
   ============================================================ */

'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const API = '';

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'admin-toast ' + (kind || 'info');
  t.textContent = msg;
  $('#toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
  return data;
}

/* ---- الحالة ---- */
const state = { models: [], tokens: [], filter: 'all', search: '' };

/* ---- التنقل ---- */
$$('.admin-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.admin-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.admin-section').forEach(s => s.classList.remove('active'));
    const sec = $('#section-' + btn.dataset.section);
    if (sec) sec.classList.add('active');
    if (btn.dataset.section === 'dashboard') refreshDashboard();
    if (btn.dataset.section === 'tokens') loadTokens();
  });
});

/* ======================== الرئيسية ======================== */
async function refreshDashboard() {
  try {
    const models = await api('/api/models');
    state.models = models;
    $('#statModels').textContent = models.length;
    $('#statActive').textContent = models.filter(m => m.active !== false).length;
  } catch (e) { /* ignore */ }
  try {
    const tokens = await api('/api/tokens');
    $('#statTokens').textContent = tokens.length;
  } catch (e) { /* ignore */ }
  try {
    const gw = await api('/api/gateway/status');
    $('#statGwStatus').textContent = gw.running ? 'يعمل' : 'متوقف';
    const dot = $('.gw-dot');
    dot.className = 'gw-dot ' + (gw.running ? 'running' : 'stopped');
  } catch (e) {
    $('#statGwStatus').textContent = 'غير معروف';
  }
  renderRecentModels();
}

function renderRecentModels() {
  const el = $('#recentModels');
  const empty = $('#recentEmpty');
  el.innerHTML = '';
  const recent = state.models.slice(-5).reverse();
  if (!recent.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  for (const m of recent) {
    const row = document.createElement('div');
    row.className = 'admin-recent-item';
    row.innerHTML = `
      <div>
        <div class="admin-recent-name">${esc(m.name)}</div>
        <div class="admin-recent-id">${esc(m.id)}</div>
      </div>
      <span class="admin-tag ${m.active === false ? 'disabled' : 'free'}">${m.active === false ? 'معطّل' : 'مفعّل'}</span>
    `;
    el.appendChild(row);
  }
}

/* ======================== النماذج ======================== */
async function loadModels() {
  try {
    state.models = await api('/api/models');
  } catch (e) {
    state.models = [];
  }
  renderModels();
}

function renderModels() {
  const grid = $('#modelsGrid');
  const empty = $('#modelsEmpty');
  grid.innerHTML = '';

  let filtered = state.models;
  if (state.filter === 'active') filtered = filtered.filter(m => m.active !== false);
  else if (state.filter === 'inactive') filtered = filtered.filter(m => m.active === false);
  else if (state.filter === 'free') filtered = filtered.filter(m => m.free);
  else if (state.filter === 'vision') filtered = filtered.filter(m => m.vision);

  if (state.search) {
    const q = state.search.toLowerCase();
    filtered = filtered.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.provider && m.provider.toLowerCase().includes(q))
    );
  }

  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  for (const m of filtered) {
    const card = document.createElement('div');
    card.className = 'admin-model-card' + (m.active === false ? ' inactive' : '');

    const badges = [];
    if (m.free) badges.push('<span class="admin-tag free">مجاني</span>');
    if (m.vision) badges.push('<span class="admin-tag vision">Vision</span>');
    if (m.video) badges.push('<span class="admin-tag video">فيديو</span>');
    if (m.active === false) badges.push('<span class="admin-tag disabled">معطّل</span>');

    const ctx = m.context ? (m.context >= 1000 ? Math.round(m.context / 1000) + 'K' : m.context) : '—';
    const out = m.maxOutput ? (m.maxOutput >= 1000 ? Math.round(m.maxOutput / 1000) + 'K' : m.maxOutput) : '—';
    const cIn = m.costIn != null ? '$' + m.costIn : '—';
    const cOut = m.costOut != null ? '$' + m.costOut : '—';

    card.innerHTML = `
      <div class="admin-model-head">
        <div>
          <div class="admin-model-name">${esc(m.name)}</div>
          <div class="admin-model-id">${esc(m.id)}</div>
        </div>
      </div>
      <div class="admin-model-badges">${badges.join('')}</div>
      <div class="admin-model-meta">
        <span>المزوّد: ${esc(m.provider)}</span>
        <span>سياق: ${ctx}</span>
        <span>إخراج: ${out}</span>
        <span>إدخال: ${cIn}</span>
        <span>إخراج: ${cOut}</span>
      </div>
      ${m.description ? '<div class="admin-model-desc">' + esc(m.description) + '</div>' : ''}
      <div class="admin-model-actions">
        <button class="admin-btn sm btn-edit" data-id="${esc(m.id)}">تعديل</button>
        <button class="admin-btn sm btn-toggle" data-id="${esc(m.id)}">${m.active === false ? 'تفعيل' : 'تعطيل'}</button>
        <button class="admin-btn sm danger btn-delete" data-id="${esc(m.id)}">حذف</button>
      </div>
    `;
    grid.appendChild(card);
  }
}

/* فتح/إغلاق النموذج */
$('#addModelBtn').addEventListener('click', () => {
  clearForm();
  $('#modelFormTitle').textContent = 'إضافة نموذج جديد';
  $('#modelFormCard').classList.remove('hidden');
  $('#modelFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#closeModelForm').addEventListener('click', () => $('#modelFormCard').classList.add('hidden'));
$('#cancelModelBtn').addEventListener('click', () => $('#modelFormCard').classList.add('hidden'));

function clearForm() {
  ['modelName', 'modelId', 'modelProvider', 'modelContext', 'modelMaxOutput', 'modelCostIn', 'modelCostOut', 'modelDesc'].forEach(id => $(('#' + id)).value = '');
  $('#modelFree').checked = false;
  $('#modelVision').checked = false;
  $('#modelVideo').checked = false;
  $('#modelActive').checked = true;
  state.editingId = null;
}

/* حفظ */
$('#saveModelBtn').addEventListener('click', async () => {
  const name = $('#modelName').value.trim();
  const id = $('#modelId').value.trim();
  const provider = $('#modelProvider').value.trim();
  if (!name || !id || !provider) { toast('الرجاء ملء جميع الحقول المطلوبة', 'error'); return; }

  const model = {
    name, id, provider,
    context: parseInt($('#modelContext').value) || null,
    maxOutput: parseInt($('#modelMaxOutput').value) || null,
    costIn: parseFloat($('#modelCostIn').value) || null,
    costOut: parseFloat($('#modelCostOut').value) || null,
    free: $('#modelFree').checked,
    vision: $('#modelVision').checked,
    video: $('#modelVideo').checked,
    active: $('#modelActive').checked,
    description: $('#modelDesc').value.trim(),
  };

  try {
    if (state.editingId) {
      await api('/api/models/' + encodeURIComponent(state.editingId), { method: 'PUT', body: JSON.stringify(model) });
      toast('تم تحديث النموذج', 'success');
    } else {
      await api('/api/models', { method: 'POST', body: JSON.stringify(model) });
      toast('تم إضافة النموذج', 'success');
    }
    $('#modelFormCard').classList.add('hidden');
    clearForm();
    loadModels();
  } catch (e) {
    toast(e.message, 'error');
  }
});

/* تعديل */
$('#modelsGrid').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.btn-edit');
  if (editBtn) {
    const m = state.models.find(x => x.id === editBtn.dataset.id);
    if (!m) return;
    state.editingId = m.id;
    $('#modelFormTitle').textContent = 'تعديل النموذج';
    $('#modelName').value = m.name || '';
    $('#modelId').value = m.id || '';
    $('#modelProvider').value = m.provider || '';
    $('#modelContext').value = m.context || '';
    $('#modelMaxOutput').value = m.maxOutput || '';
    $('#modelCostIn').value = m.costIn != null ? m.costIn : '';
    $('#modelCostOut').value = m.costOut != null ? m.costOut : '';
    $('#modelFree').checked = !!m.free;
    $('#modelVision').checked = !!m.vision;
    $('#modelVideo').checked = !!m.video;
    $('#modelActive').checked = m.active !== false;
    $('#modelDesc').value = m.description || '';
    $('#modelFormCard').classList.remove('hidden');
    $('#modelFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const toggleBtn = e.target.closest('.btn-toggle');
  if (toggleBtn) {
    const m = state.models.find(x => x.id === toggleBtn.dataset.id);
    if (!m) return;
    try {
      await api('/api/models/' + encodeURIComponent(m.id), {
        method: 'PUT',
        body: JSON.stringify({ active: m.active === false ? true : false }),
      });
      toast(m.active === false ? 'تم تفعيل النموذج' : 'تم تعطيل النموذج', 'info');
      loadModels();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }

  const delBtn = e.target.closest('.btn-delete');
  if (delBtn) {
    if (!confirm('هل أنت متأكد من حذف هذا النموذج؟')) return;
    try {
      await api('/api/models/' + encodeURIComponent(delBtn.dataset.id), { method: 'DELETE' });
      toast('تم حذف النموذج', 'success');
      loadModels();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
});

/* بحث وفلترة */
$('#modelsSearch').addEventListener('input', (e) => { state.search = e.target.value; renderModels(); });
$('#modelsFilter').addEventListener('change', (e) => { state.filter = e.target.value; renderModels(); });

/* ======================== التوكنات ======================== */
async function loadTokens() {
  try {
    state.tokens = await api('/api/tokens');
  } catch (e) { state.tokens = []; }
  renderTokens();
}

function renderTokens() {
  const list = $('#tokensList');
  const empty = $('#tokensEmpty');
  list.innerHTML = '';
  if (!state.tokens.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  for (const tk of state.tokens) {
    const row = document.createElement('div');
    row.className = 'admin-token-row';
    row.innerHTML = `
      <div class="admin-token-info">
        <div class="admin-token-provider">${esc(tk.provider)}</div>
        <div class="admin-token-key">${esc(tk.key)}</div>
      </div>
      <button class="admin-btn sm danger btn-del-token" data-provider="${esc(tk.provider)}">حذف</button>
    `;
    list.appendChild(row);
  }
}

$('#toggleTokenVis').addEventListener('click', () => {
  const inp = $('#tokenKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  $('#toggleTokenVis').textContent = inp.type === 'password' ? 'إظهار' : 'إخفاء';
});

$('#tokenProvider').addEventListener('change', () => {
  $('#customProviderGroup').classList.toggle('hidden', $('#tokenProvider').value !== 'custom');
});

$('#saveTokenBtn').addEventListener('click', async () => {
  let provider = $('#tokenProvider').value;
  if (provider === 'custom') provider = $('#customProviderName').value.trim();
  const key = $('#tokenKey').value.trim();
  const baseUrl = $('#tokenBaseUrl').value.trim();
  if (!provider || !key) { toast('الرجاء اختيار المزوّد وإدخال التوكن', 'error'); return; }

  try {
    await api('/api/tokens', { method: 'POST', body: JSON.stringify({ provider, key, baseUrl: baseUrl || null }) });
    toast('تم حفظ التوكن', 'success');
    $('#tokenKey').value = '';
    $('#tokenBaseUrl').value = '';
    loadTokens();
  } catch (e) { toast(e.message, 'error'); }
});

$('#tokensList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-del-token');
  if (!btn) return;
  if (!confirm('حذف توكن ' + btn.dataset.provider + '؟')) return;
  try {
    await api('/api/tokens/' + encodeURIComponent(btn.dataset.provider), { method: 'DELETE' });
    toast('تم حذف التوكن', 'success');
    loadTokens();
  } catch (e) { toast(e.message, 'error'); }
});

/* ======================== الإعدادات ======================== */
async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    $('#settingsGithubRepo').value = settings.githubRepo || '';
    // لا نعرض التوكن الكامل — فقط نعلم أنه موجود
    if (settings.githubToken) {
      $('#settingsGithubToken').value = '';
      $('#settingsGithubToken').placeholder = 'تم الحفظ (اتركه فارغاً للإبقاء عليه)';
    }
  } catch (e) { /* ignore */ }
  try {
    const info = await api('/api/info');
    const badge = $('#settingsGithubStatus');
    if (info.githubConfigured) {
      badge.textContent = 'متصل';
      badge.className = 'admin-status-badge running';
    } else {
      badge.textContent = 'غير مُعد';
      badge.className = 'admin-status-badge stopped';
    }
  } catch (e) { /* ignore */ }
}

$('#toggleTokenVis').addEventListener('click', () => {
  const inp = $('#settingsGithubToken');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  $('#toggleTokenVis').textContent = inp.type === 'password' ? 'إظهار' : 'إخفاء';
});

$('#saveGithubSettings').addEventListener('click', async () => {
  const repo = $('#settingsGithubRepo').value.trim();
  const token = $('#settingsGithubToken').value.trim();
  if (!repo) { toast('الرجاء إدخال رابط المستودع', 'error'); return; }

  const body = { githubRepo: repo };
  if (token) body.githubToken = token;

  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    toast('تم حفظ إعدادات GitHub', 'success');
    loadSettings();
  } catch (e) { toast(e.message, 'error'); }
});

$('#testGithubConnection').addEventListener('click', async () => {
  try {
    const result = await api('/api/sync/test', { method: 'POST' });
    if (result.ok) {
      toast('✓ الاتصال ناجح — يوجد ' + result.modelCount + ' نموذج على GitHub', 'success');
      $('#settingsGithubModelCount').textContent = result.modelCount;
    }
  } catch (e) { toast('خطأ: ' + e.message, 'error'); }
});

$('#pushToGithubBtn').addEventListener('click', async () => {
  try {
    await api('/api/sync/push', { method: 'POST' });
    toast('تم رفع النماذج إلى GitHub بنجاح', 'success');
  } catch (e) { toast('خطأ: ' + e.message, 'error'); }
});

$('#pullFromGithubBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/sync/pull', { method: 'POST' });
    toast('تم جلب ' + result.models.length + ' نموذج من GitHub', 'success');
    loadModels();
    refreshDashboard();
  } catch (e) { toast('خطأ: ' + e.message, 'error'); }
});

$('#exportModelsBtn').addEventListener('click', async () => {
  try {
    const models = await api('/api/models');
    download('jmf-admin-models.json', JSON.stringify(models, null, 2));
    toast('تم تصدير النماذج', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

$('#importModelsBtn').addEventListener('click', () => $('#importModelsInput').click());

$('#importModelsInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('الملف يجب أن يحتوي على مصفوفة');
    let count = 0;
    for (const m of imported) {
      if (m.id && m.name && m.provider) {
        try { await api('/api/models', { method: 'POST', body: JSON.stringify(m) }); count++; } catch (e) { /* skip duplicates */ }
      }
    }
    toast('تم استيراد ' + count + ' نموذج', 'success');
    loadModels();
  } catch (e) { toast('خطأ: ' + e.message, 'error'); }
  e.target.value = '';
});

$('#exportTokensBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/tokens/raw');
    const tokens = await res.json();
    download('jmf-admin-tokens.json', JSON.stringify(tokens, null, 2));
    toast('تم تصدير التوكنات', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

function download(name, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* ---- helpers ---- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- التهيئة ---- */
async function init() {
  await loadModels();
  refreshDashboard();
  loadSettings();
  try {
    const info = await api('/api/info');
    $('#settingsPort').textContent = info.port;
    $('#settingsModelCount').textContent = info.modelCount;
    $('#adminVersionFooter').textContent = 'v' + info.version;
  } catch (e) { /* ignore */ }
}

init();
