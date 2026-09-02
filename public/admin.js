/* ============================================================
   jmf SaaS Admin — منطق اللوحة (SPA) — فاتح/داكن + أقسام SaaS
   ============================================================ */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var mon = function (v) { return '<span class="mono">' + esc(v) + '</span>'; };
  var fmtNum = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var fmtUsd = function (n) { return '$' + Number(n || 0).toFixed(4); };
  var fmtDate = function (d) { if (!d) return '—'; try { return new Date(d).toLocaleString('ar-EG'); } catch (e) { return '—'; } };
  var fmtDateShort = function (d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-EG'); } catch (e) { return '—'; } };

  var TITLES = {
    dashboard: ['نظرة عامة', 'مؤشرات النظام والكوتة لحظياً'],
    analytics: ['التحليلات', 'استهلاك الطلبات والتكلفة والأخطاء'],
    subscribers: ['المستخدمون', 'إدارة المستخدمين واشتراكاتهم'],
    plans: ['الباقات والأسعار', 'تحكم كامل بخطط الاشتراك والعروض'],
    broadcasts: ['الإعلانات والبث', 'نشر رسائل تصل لجميع المستخدمين'],
    health: ['صحة المزوّدين', 'حالة المفاتيح والكوتة والمزوّدين'],
    keys: ['المفاتيح', 'إدارة مفاتيح جميع المزوّدين وربطها بالنماذج'],
    models: ['النماذج', 'إدارة نماذج المحادثة والتوليد وربط كل نموذج بمفتاحه'],
    providers: ['المزوّدون والبوابة', 'مفاتيح الدردشة وحالة OmniRoute'],
    activity: ['سجل التدقيق', 'أرشيف زمني موحّد لكل العمليات'],
    settings: ['الإعدادات', 'إعدادات اللوحة والتوجيه والضغط'],
  };

  var state = { section: 'dashboard', data: {} };
  var F = {
    api: function (path, opts) {
      opts = opts || {};
      return fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (r) { return r.json().catch(function () { return {}; }); });
    },
    toast: function (msg, type) {
      var t = document.createElement('div');
      t.className = 'toast ' + (type || 'info');
      t.textContent = msg;
      $('#toasts').appendChild(t);
      setTimeout(function () { t.remove(); }, 4000);
    },
    modal: function (html) {
      $('#modalBox').innerHTML = html;
      $('#modalOverlay').classList.remove('hidden');
    },
    closeModal: function () { $('#modalOverlay').classList.add('hidden'); },
  };

  /* ==================== الشريط الجانبي والتنقل ==================== */
  function navigate(section) {
    state.section = section;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.section === section); });
    var t = TITLES[section] || [section, ''];
    $('#pageTitle').textContent = t[0];
    $('#pageSubtitle').textContent = t[1];
    var lu = $('#lastUpdated');
    if (lu) lu.textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
    render(section);
  }

  /* ==================== لوحة المعلومات ==================== */
  function renderDashboard() {
    var v = $('#view');
    var isFirstLoad = !$('#statGridWrap');
    if (isFirstLoad) v.innerHTML = '<div class="muted">جاري التحميل…</div>';
    Promise.all([
      F.api('/api/analytics/overview'),
      F.api('/api/health/keys'),
      F.api('/api/users/stats'),
      F.api('/api/system/health'),
      F.api('/api/activity?limit=8'),
    ]).then(function (res) {
      var ov = res[0] || {};
      var health = res[1] || {};
      var users = res[2] || {};
      var sys = res[3] || {};
      var act = res[4] || [];
      var today = ov.today || {};
      var all = ov.all || {};
      var keysSum = health.summary || {};

      if (isFirstLoad) {
        var html = ''
          + '<div id="statGridWrap" class="stat-grid">'
          + '<div class="stat-card" id="dsModels"><div class="stat-top"><div class="stat-ic ic-blue">◈</div></div><div class="stat-val">—</div><div class="stat-lbl">نموذج مُفعل</div><div class="stat-mini">من لوحة النماذج</div></div>'
          + '<div class="stat-card" id="dsRequests"><div class="stat-top"><div class="stat-ic ic-teal">◈</div></div><div class="stat-val">—</div><div class="stat-lbl">طلبات اليوم</div><div class="stat-mini">—</div></div>'
          + '<div class="stat-card" id="dsKeys"><div class="stat-top"><div class="stat-ic ic-amber">◈</div></div><div class="stat-val">—</div><div class="stat-lbl">مفاتيح صحيحة</div><div class="stat-mini">—</div></div>'
          + '<div class="stat-card" id="dsUsers"><div class="stat-top"><div class="stat-ic ic-purple">◈</div></div><div class="stat-val">—</div><div class="stat-lbl">مستخدم فريد</div><div class="stat-mini">—</div></div>'
          + '<div class="stat-card" id="dsCost"><div class="stat-top"><div class="stat-ic ic-red">◈</div></div><div class="stat-val">—</div><div class="stat-lbl">تكلفة (14 يوم)</div><div class="stat-mini">—</div></div>'
          + '</div>'
          + '<div class="grid-2">'
          + '<div class="card"><div class="card-head"><h3>طلبات آخر 14 يوم</h3><button class="link-btn" data-go="analytics">تحليلات ←</button></div><div id="miniChart"></div></div>'
          + '<div class="card"><div class="card-head"><h3>أحدث نشاطات</h3><button class="link-btn" data-go="activity">السجل ←</button></div><div id="miniAct"></div></div>'
          + '</div>'
          + '<div class="card"><div class="card-head"><h3>حالة النظام</h3></div>'
          + '<div class="grid-2">'
          + '<div class="bar-row" id="dsOmni"><div class="br-head"><span>البوابة OmniRoute</span><span><span class="tag">—</span></span></div></div>'
          + '<div class="bar-row" id="dsSupa"><div class="br-head"><span>Supabase</span><span><span class="tag">—</span></span></div></div>'
          + '<div class="bar-row" id="dsActModels"><div class="br-head"><span>النماذج النشطة</span><span><span class="tag">—</span></span></div></div>'
          + '<div class="bar-row" id="dsUptime"><div class="br-head"><span>زمن التشغيل</span><span><span class="tag">—</span></span></div></div>'
          + '</div></div>';
        v.innerHTML = html;
        bindGo();
      }

      /* تحديث القيم بدون استبدال HTML */
      var g = $('#dsModels'); if (g) { g.querySelector('.stat-val').textContent = ov.modelCount || 0; }
      var r = $('#dsRequests'); if (r) { r.querySelector('.stat-val').textContent = fmtNum(today.requests || 0); r.querySelector('.stat-mini').textContent = fmtNum(all.requests || 0) + ' إجمالي'; }
      var k = $('#dsKeys'); if (k) { k.querySelector('.stat-val').textContent = (keysSum.ok || 0) + '/' + (keysSum.total || 0); k.querySelector('.stat-mini').textContent = (keysSum.low || 0) + ' منخفضة • ' + (keysSum.exhausted || 0) + ' منتهية'; }
      var u = $('#dsUsers'); if (u) { u.querySelector('.stat-val').textContent = fmtNum(all.uniqueUsers || 0); u.querySelector('.stat-mini').textContent = (users.users || []).length + ' ملف'; }
      var c = $('#dsCost'); if (c) { c.querySelector('.stat-val').textContent = fmtUsd(all.cost || 0); c.querySelector('.stat-mini').textContent = today.cost ? 'اليوم: ' + fmtUsd(today.cost) : '—'; }

      var setTag = function (id, txt, cls) { var el = $(id); if (el) { var t = el.querySelector('.tag'); if (t) { t.textContent = txt; t.className = 'tag tag-' + cls; } } };
      setTag('#dsOmni', (sys.components && sys.components.omniroute && sys.components.omniroute.running) ? 'تعمل' : 'متوقفة', (sys.components && sys.components.omniroute && sys.components.omniroute.running) ? 'ok' : 'danger');
      setTag('#dsSupa', (sys.components && sys.components.supabase && sys.components.supabase.status === 'healthy') ? 'متصل' : 'غير مُعد', (sys.components && sys.components.supabase && sys.components.supabase.status === 'healthy') ? 'ok' : 'warn');
      setTag('#dsActModels', sys.stats ? sys.stats.activeModels : 0, 'info');
      setTag('#dsUptime', sys.uptime ? Math.round(sys.uptime / 60) + ' دقيقة' : '—', 'info');

      var actEl = $('#miniAct');
      if (actEl) actEl.innerHTML = activityRows(act);
      loadTimeline('#miniChart', 14, true);
    }).catch(function () {
      if (isFirstLoad) v.innerHTML = '<div class="empty">تعذر تحميل البيانات</div>';
    });
  }
  function statCard(cls, val, lbl, mini) {
    return '<div class="stat-card"><div class="stat-top"><div class="stat-ic ' + cls + '">◈</div></div><div class="stat-val">' + val + '</div><div class="stat-lbl">' + lbl + '</div><div class="stat-mini">' + mini + '</div></div>';
  }
  function sysRow(k, val, cls) {
    return '<div class="bar-row"><div class="br-head"><span>' + k + '</span><span><span class="tag tag-' + cls + '">' + val + '</span></span></div></div>';
  }
  function activityRows(rows) {
    if (!rows || !rows.length) return '<div class="empty">لا نشاطات بعد</div>';
    return '<table><thead><tr><th>الحدث</th><th>التفاصيل</th><th>الوقت</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td>' + mon(r.action) + '</td><td>' + esc(r.details) + '</td><td>' + fmtDate(r.time || r.created_at) + '</td></tr>'; }).join('')
      + '</tbody></table>';
  }
  function bindGo() {
    $$('[data-go]').forEach(function (b) { b.onclick = function () { navigate(b.dataset.go); }; });
  }

  /* ==================== الرسوم البيانية ==================== */
  function loadTimeline(sel, days, mini) {
    var el = $(sel);
    if (!el) return;
    F.api('/api/analytics/timeline?days=' + (days || 14)).then(function (r) {
      var pts = (r.points || []).slice(-14);
      if (!pts.length) { el.innerHTML = '<div class="empty">لا بيانات</div>'; return; }
      var max = Math.max.apply(null, pts.map(function (p) { return p.requests; })) || 1;
      el.innerHTML = '<div class="chart-bars">'
        + pts.map(function (p) {
          var h = Math.max(2, Math.round((p.requests / max) * 160));
          return '<div class="cb" title="' + p.day + ': ' + fmtNum(p.requests) + ' طلب"><div class="bar" style="height:' + h + 'px"></div><div class="lbl">' + (p.day ? p.day.slice(8) : '') + '</div></div>';
        }).join('')
        + '</div>'
        + (mini ? '' : '<div class="legend">'
          + '<div class="li"><span class="dot" style="background:var(--primary)"></span>' + fmtNum(pts.reduce(function (a, p) { return a + p.requests; }, 0)) + ' طلب</div>'
          + '<div class="li"><span class="dot" style="background:var(--danger)"></span>' + fmtNum(pts.reduce(function (a, p) { return a + p.errors; }, 0)) + ' خطأ</div>'
          + '</div>');
    });
  }

  /* ==================== التحليلات ==================== */
  function renderAnalytics() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><select id="anDays"><option value="7">آخر 7 أيام</option><option value="14" selected>آخر 14 يوم</option><option value="30">آخر 30 يوم</option></select></div>'
      + '<div id="anBody"><div class="empty">جاري التحميل…</div></div>';
    loadAnalytics(7);
    $('#anDays').addEventListener('change', function () { loadAnalytics(Number(this.value)); });
  }
  function loadAnalytics(days) {
    Promise.all([
      F.api('/api/analytics/overview'),
      F.api('/api/analytics/timeline?days=' + days),
      F.api('/api/analytics/breakdown'),
    ]).then(function (res) {
      var ov = res[0] || {};
      var tl = res[1] || {};
      var bd = (res[2] || {}).breakdown || { byProvider: [], byModel: [], byUser: [] };
      var today = ov.today || {};
      var all = ov.all || {};
      $('#anBody').innerHTML = ''
        + '<div class="stat-grid">'
        + statCard('ic-blue', fmtNum(today.requests || 0), 'طلبات اليوم', fmtNum(all.requests || 0) + ' إجمالي')
        + statCard('ic-red', (today.errors || 0) + (today.requests ? ' (' + Math.round(today.errors / today.requests * 100) + '%)' : ''), 'أخطاء اليوم', 'متوسط زمن: ' + (all.avgLatency || 0) + 'ms')
        + statCard('ic-amber', fmtUsd(today.cost || 0), 'تكلفة اليوم', fmtUsd(all.cost || 0) + ' إجمالي')
        + statCard('ic-purple', fmtNum(all.uniqueUsers || 0), 'مستخدم فريد', 'بكل الأوقات')
        + '</div>'
        + '<div class="card"><div class="card-head"><h3>الطلبات اليومية (' + days + ' يوم)</h3></div><div id="tlChart"></div></div>'
        + '<div class="grid-2">'
        + breakdownCard('حسب المزوّد', bd.byProvider)
        + breakdownCard('حسب النموذج', bd.byModel)
        + '</div>'
        + '<div class="card"><div class="card-head"><h3>حسب المستخدم</h3></div><div class="table-card">' + userTable(bd.byUser) + '</div></div>';
      renderBars('#tlChart', tl.points || []);
    });
  }
  function breakdownCard(title, list) {
    list = list || [];
    var max = Math.max.apply(null, list.map(function (x) { return x.requests; }).concat([1]));
    return '<div class="card"><div class="card-head"><h3>' + title + '</h3></div>'
      + list.map(function (x) {
        return '<div class="bar-row"><div class="br-head"><span>' + esc(x.name) + '</span><span>' + fmtNum(x.requests) + ' • ' + fmtUsd(x.cost) + '</span></div><div class="bar-lg"><div class="bar-fill" style="width:' + Math.max(3, Math.round(x.requests / max * 100)) + '%"></div></div></div>';
      }).join('')
      + (list.length ? '' : '<div class="empty">لا بيانات</div>')
      + '</div>';
  }
  function userTable(byUser) {
    var list = byUser || [];
    if (!list.length) return '<div class="empty">لا بيانات بعد</div>';
    return '<table><thead><tr><th>المستخدم</th><th>الطلبات</th><th>التكلفة</th></tr></thead><tbody>'
      + list.map(function (u) { return '<tr><td>' + esc(u.name) + '</td><td>' + fmtNum(u.requests) + '</td><td>' + fmtUsd(u.cost) + '</td></tr>'; }).join('')
      + '</tbody></table>';
  }
  function renderBars(sel, pts) {
    var el = $(sel);
    if (!el) return;
    if (!pts.length) { el.innerHTML = '<div class="empty">لا بيانات</div>'; return; }
    var max = Math.max.apply(null, pts.map(function (p) { return p.requests; })) || 1;
    el.innerHTML = '<div class="chart-bars">'
      + pts.map(function (p) { return '<div class="cb" title="' + p.day + ': ' + fmtNum(p.requests) + '"><div class="bar" style="height:' + Math.max(2, Math.round((p.requests / max) * 160)) + 'px"></div><div class="lbl">' + (p.day || '').slice(5) + '</div></div>'; }).join('')
      + '</div>'
      + '<div class="legend">'
      + '<div class="li"><span class="dot" style="background:var(--primary)"></span>الطلبات</div>'
      + '<div class="li"><span class="dot" style="background:var(--danger)"></span>الأخطاء</div>'
      + '</div>';
  }

  /* ==================== المستخدمون ==================== */
  function renderSubscribers() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><input type="search" id="subSearch" placeholder="بحث بالبريد/الاسم…"><select id="subPlan"><option value="">كل الباقات</option><option>free</option><option>pro</option><option>premium</option></select></div><div id="subBody"><div class="empty">جاري التحميل…</div></div>';
    loadSubscribers();
    $('#subSearch').addEventListener('input', loadSubscribers);
    $('#subPlan').addEventListener('change', loadSubscribers);
  }
  function loadSubscribers() {
    var q = ($('#subSearch').value || '').trim().toLowerCase();
    var plan = $('#subPlan').value;
    F.api('/api/users/stats').then(function (r) {
      var users = (r.users || []).filter(function (u) {
        if (plan && u.plan !== plan) return false;
        if (q && !(u.email || '').toLowerCase().includes(q) && !(u.name || '').toLowerCase().includes(q)) return false;
        return true;
      });
      $('#subBody').innerHTML = '<div class="card table-card"><table><thead><tr><th>المستخدم</th><th>البريد</th><th>الباقة</th><th>صور</th><th>إجمالي</th><th>إجراءات</th></tr></thead><tbody>'
        + users.map(function (u) {
          return '<tr><td>' + esc(u.name) + '</td><td>' + (u.email || '—') + '</td>'
            + '<td><span class="tag tag-' + (u.plan === 'premium' ? 'ok' : (u.plan === 'pro' ? 'info' : 'mute')) + '">' + esc(u.plan || 'free') + '</span></td>'
            + '<td>' + fmtNum(u.imagesToday) + '/' + fmtNum(u.imagesGenerated) + '</td>'
            + '<td>' + fmtNum(u.totalRequests) + '</td>'
            + '<td><button class="btn btn-sm" data-id="' + esc(u.id || u.email) + '" data-email="' + esc(u.email || '') + '" onclick="window.__setPlan(this)">تغيير الباقة</button></td></tr>';
        }).join('')
        + (users.length ? '' : '<tr><td colspan="6" class="empty">لا مستخدمين مطابقين</td></tr>')
        + '</tbody></table></div>';
    });
  }
  window.__setPlan = function (btn) {
    var id = btn.dataset.id, email = btn.dataset.email;
    F.api('/api/plans').then(function (r) {
      var plans = r.plans || [];
      F.modal('<h3>تغيير باقة المستخدم</h3><div class="form-grid">'
        + '<div class="field full"><label>المستخدم</label><input value="' + esc(email || id) + '" disabled></div>'
        + '<div class="field"><label>الباقة</label><select id="mPlan">' + plans.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></div>'
        + '<div class="field"><label>الحالة</label><select id="mStatus"><option>active</option><option>canceled</option><option>past_due</option></select></div>'
        + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveSub(\'' + esc(id) + '\',\'' + esc(email) + '\')">حفظ</button></div>');
    });
  };
  window.__saveSub = function (id, email) {
    var plan = $('#mPlan').value, status = $('#mStatus').value;
    F.api('/api/subscriptions', { method: 'POST', body: { userId: id, email: email, plan: plan, status: status } }).then(function (r) {
      if (r.ok) { F.toast('تم تحديث اشتراك المستخدم', 'ok'); F.closeModal(); loadSubscribers(); }
      else F.toast(r.error || 'فشل التحديث', 'err');
    });
  };
  window.__closeModal = function () { F.closeModal(); };

  /* ==================== الباقات ==================== */
  function renderPlans() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><button class="btn" id="plansReload">↻ إعادة تحميل</button><button class="btn btn-primary" id="plansAdd">+ باقة جديدة</button></div><div id="plansBody"><div class="empty">جاري التحميل…</div></div>';
    loadPlans();
    $('#plansReload').onclick = loadPlans;
    $('#plansAdd').onclick = function () {
      F.modal('<h3>باقة جديدة</h3><div class="form-grid">'
        + '<div class="field"><label>المعرّف (id)</label><input id="pId" placeholder="pro2"></div>'
        + '<div class="field"><label>الاسم</label><input id="pName" placeholder="متقدم"></div>'
        + '<div class="field"><label>السعر $</label><input id="pPrice" type="number" step="0.01" value="0"></div>'
        + '<div class="field"><label>الدورة</label><select id="pCycle"><option>month</option><option>year</option><option>lifetime</option></select></div>'
        + '<div class="field"><label>كوتة صور</label><input id="pQuota" type="number" value="100"></div>'
        + '<div class="field"><label>رؤية الصور</label><select id="pVision"><option value="true">نعم</option><option value="false">لا</option></select></div>'
        + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__savePlan(null)">حفظ</button></div>');
    };
  }
  function loadPlans() {
    F.api('/api/plans').then(function (r) {
      state.data.plans = r.plans || [];
      $('#plansBody').innerHTML = '<div class="grid-2">'
        + state.data.plans.map(function (p) {
          return '<div class="card"><div class="card-head"><h3>' + esc(p.name) + ' <span class="tag tag-info">' + esc(p.id) + '</span></h3>'
            + '<div><button class="btn btn-sm" onclick="window.__editPlan(\'' + esc(p.id) + '\')">تعديل</button> <button class="btn btn-sm" onclick="window.__delPlan(\'' + esc(p.id) + '\')">حذف</button></div></div>'
            + '<p style="font-size:24px;font-weight:800">' + fmtUsd(p.price) + ' <span style="font-size:12px;color:var(--tx-dim)">/ ' + esc(p.cycle) + '</span></p>'
            + '<p style="margin:8px 0;color:var(--tx-dim)">كوتة الصور: ' + fmtNum(p.imageQuota) + ' • الرؤية: ' + (p.vision ? 'مفعّلة' : 'معطّلة') + '</p>'
            + '<ul style="padding-inline-start:18px;margin:6px 0">' + (p.features || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
            + '</div>';
        }).join('')
        + '</div>';
    });
  }
  window.__editPlan = function (id) {
    var p = (state.data.plans || []).find(function (x) { return x.id === id; });
    if (!p) return;
    F.modal('<h3>تعديل الباقة: ' + esc(p.name) + '</h3><div class="form-grid">'
      + '<div class="field"><label>الاسم</label><input id="pName" value="' + esc(p.name) + '"></div>'
      + '<div class="field"><label>السعر $</label><input id="pPrice" type="number" step="0.01" value="' + (p.price || 0) + '"></div>'
      + '<div class="field"><label>الدورة</label><select id="pCycle"><option value="month"' + (p.cycle === 'month' ? ' selected' : '') + '>month</option><option value="year"' + (p.cycle === 'year' ? ' selected' : '') + '>year</option></select></div>'
      + '<div class="field"><label>كوتة صور</label><input id="pQuota" type="number" value="' + (p.imageQuota || 0) + '"></div>'
      + '<div class="field"><label>الرؤية</label><select id="pVision"><option value="true"' + (p.vision ? ' selected' : '') + '>نعم</option><option value="false"' + (!p.vision ? ' selected' : '') + '>لا</option></select></div>'
      + '<div class="field full"><label>المزايا (سطر لكل ميزة)</label><textarea id="pFeat">' + esc((p.features || []).join('\n')) + '</textarea></div>'
      + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__savePlan(\'' + esc(id) + '\')">حفظ</button></div>');
  };
  window.__savePlan = function (id) {
    var plans = (state.data.plans || []).slice();
    if (id && !($('#pName') && $('#pPrice'))) return;
    var rec = {
      id: id || $('#pId').value.trim(),
      name: $('#pName').value.trim() || (id || 'new'),
      price: Number($('#pPrice').value) || 0,
      cycle: $('#pCycle').value,
      imageQuota: Number($('#pQuota').value) || 0,
      vision: $('#pVision').value === 'true',
      features: ($('#pFeat') ? $('#pFeat').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : []),
    };
    if (id) {
      var i = plans.findIndex(function (x) { return x.id === id; });
      if (i >= 0) { plans[i] = Object.assign({}, plans[i], rec); }
    } else {
      if (plans.find(function (x) { return x.id === rec.id; })) { F.toast('المعرّف مستخدم مسبقاً', 'err'); return; }
      plans.push(rec);
    }
    F.api('/api/plans', { method: 'POST', body: { plans: plans } }).then(function (r) {
      if (r.ok) { F.toast('تم حفظ الباقات', 'ok'); F.closeModal(); loadPlans(); }
      else F.toast(r.error || 'فشل الحفظ', 'err');
    });
  };
  window.__delPlan = function (id) {
    if (!confirm('حذف الباقة ' + id + '؟')) return;
    var plans = (state.data.plans || []).filter(function (x) { return x.id !== id; });
    F.api('/api/plans', { method: 'POST', body: { plans: plans } }).then(function (r) {
      if (r.ok) { F.toast('تم حذف الباقة', 'ok'); loadPlans(); }
    });
  };

  /* ==================== الإعلانات ==================== */
  function renderBroadcasts() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><button class="btn btn-primary" id="bcAdd">+ إعلان جديد</button></div><div id="bcBody"><div class="empty">جاري التحميل…</div></div>';
    loadBroadcasts();
    $('#bcAdd').onclick = function () {
      F.modal('<h3>إعلان جديد</h3><div class="form-grid">'
        + '<div class="field full"><label>العنوان</label><input id="bTitle" placeholder="تحديث جديد…"></div>'
        + '<div class="field full"><label>النص</label><textarea id="bBody" placeholder="تفاصيل الإعلان…"></textarea></div>'
        + '<div class="field"><label>الأولوية</label><input id="bPri" type="number" value="0"></div>'
        + '<div class="field"><label>تنتهي في (اختياري)</label><input id="bExp" type="datetime-local"></div>'
        + '<div class="field full checkbox-field"><label><input type="checkbox" id="bActive" checked> مفعّل فوراً</label></div>'
        + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveBc(null)">نشر</button></div>');
    };
  }
  function loadBroadcasts() {
    F.api('/api/broadcasts').then(function (r) {
      var list = Array.isArray(r) ? r : [];
      $('#bcBody').innerHTML = '<div class="card table-card"><table><thead><tr><th>العنوان</th><th>النص</th><th>الحالة</th><th>الأولوية</th><th>الانتهاء</th><th>إجراءات</th></tr></thead><tbody>'
        + list.map(function (b) {
          return '<tr><td>' + esc(b.title) + '</td><td style="max-width:260px;white-space:normal">' + esc(b.body) + '</td>'
            + '<td><span class="tag tag-' + (b.active ? 'ok' : 'mute') + '">' + (b.active ? 'نشط' : 'معطّل') + '</span></td>'
            + '<td>' + (b.priority || 0) + '</td>'
            + '<td>' + (b.expiresAt ? fmtDateShort(b.expiresAt) : '—') + '</td>'
            + '<td><button class="btn btn-sm" onclick="window.__toggleBc(\'' + esc(b.id) + '\',' + (b.active ? '0' : '1') + ')">' + (b.active ? 'إيقاف' : 'تفعيل') + '</button> '
            + '<button class="btn btn-sm" onclick="window.__editBc(\'' + esc(b.id) + '\')">تعديل</button> '
            + '<button class="btn btn-sm" onclick="window.__delBc(\'' + esc(b.id) + '\')">حذف</button></td></tr>';
        }).join('')
        + (list.length ? '' : '<tr><td colspan="6" class="empty">لا إعلانات بعد</td></tr>')
        + '</tbody></table></div>';
    });
  }
  window.__toggleBc = function (id, active) {
    F.api('/api/broadcasts/' + encodeURIComponent(id), { method: 'PUT', body: { active: !!active } }).then(function () { F.toast('تم تحديث الإعلان', 'ok'); loadBroadcasts(); });
  };
  window.__editBc = function (id) {
    F.api('/api/broadcasts').then(function (r) {
      var b = (Array.isArray(r) ? r : []).find(function (x) { return x.id === id; });
      if (!b) return;
      F.modal('<h3>تعديل الإعلان</h3><div class="form-grid">'
        + '<div class="field full"><label>العنوان</label><input id="bTitle" value="' + esc(b.title) + '"></div>'
        + '<div class="field full"><label>النص</label><textarea id="bBody">' + esc(b.body) + '</textarea></div>'
        + '<div class="field"><label>الأولوية</label><input id="bPri" type="number" value="' + (b.priority || 0) + '"></div>'
        + '<div class="field full checkbox-field"><label><input type="checkbox" id="bActive" ' + (b.active ? 'checked' : '') + '> مفعّل</label></div>'
        + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveBc(\'' + esc(id) + '\')">حفظ</button></div>');
    });
  };
  window.__saveBc = function (id) {
    var body = {
      title: $('#bTitle').value.trim(),
      body: $('#bBody').value,
      active: $('#bActive').checked,
      priority: Number($('#bPri').value) || 0,
      expiresAt: ($('#bExp') && $('#bExp').value) || null,
    };
    if (!body.title) { F.toast('العنوان مطلوب', 'err'); return; }
    var path = '/api/broadcasts' + (id ? '/' + encodeURIComponent(id) : '');
    F.api(path, { method: id ? 'PUT' : 'POST', body: body }).then(function (r) {
      if (r.ok || r.broadcast) { F.toast(id ? 'تم تحديث الإعلان' : 'تم نشر الإعلان للجميع', 'ok'); F.closeModal(); loadBroadcasts(); }
      else F.toast(r.error || 'فشل الحفظ', 'err');
    });
  };
  window.__delBc = function (id) {
    if (!confirm('حذف الإعلان؟')) return;
    F.api('/api/broadcasts/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { F.toast('تم الحذف', 'ok'); loadBroadcasts(); });
  };

  /* ==================== صحة المزوّدين ==================== */
  function renderHealth() {
    var v = $('#view');
    v.innerHTML = '<div id="healthBody"><div class="empty">جاري التحميل…</div></div>';
    loadHealth();
  }
  function loadHealth() {
    Promise.all([F.api('/api/health/keys'), F.api('/api/health/providers')]).then(function (res) {
      var keys = res[0] || {};
      var provs = res[1] || {};
      var sum = keys.summary || {};
      $('#healthBody').innerHTML = ''
        + '<div class="stat-grid">'
        + statCard('ic-teal', sum.ok || 0, 'مفاتيح سليمة', 'من ' + (sum.total || 0))
        + statCard('ic-amber', sum.low || 0, 'كوتة منخفضة', 'أقل من 20%')
        + statCard('ic-red', sum.exhausted || 0, 'منتهية', '50px')
        + statCard('ic-purple', sum.disabled || 0, 'معطّلة', 'مفاتيح')
        + '</div>'
        + '<div class="card"><div class="card-head"><h3>صحة مفاتيح الصور</h3></div><div class="table-card"><table><thead><tr><th>المزوّد</th><th>التسمية</th><th>الحالة</th><th>المستخدم / الكوتة</th><th>المتبقي</th></tr></thead><tbody>'
        + (keys.keys || []).map(function (k) {
          var cls = k.health === 'ok' ? 'ok' : (k.health === 'low' ? 'warn' : (k.health === 'exhausted' ? 'danger' : 'mute'));
          var lbl = { ok: 'سليم', low: 'منخفضة', exhausted: 'منتهية', disabled: 'معطّلة' }[k.health] || k.health;
          return '<tr><td>' + esc(k.provider) + '</td><td>' + esc(k.label || '—') + '</td>'
            + '<td><span class="tag tag-' + cls + '">' + lbl + '</span></td>'
            + '<td>' + fmtNum(k.usedToday) + ' / ' + fmtNum(k.quotaDaily) + '</td>'
            + '<td>' + fmtNum(k.remaining) + '</td></tr>';
        }).join('')
        + (keys.keys && keys.keys.length ? '' : '<tr><td colspan="5" class="empty">لا مفاتيح</td></tr>')
        + '</tbody></table></div></div>'
        + '<div class="card"><div class="card-head"><h3>مزوّدو الدردشة</h3></div><div class="table-card"><table><thead><tr><th>المزوّد</th><th>التسمية</th><th>الحالة</th></tr></thead><tbody>'
        + (provs.providers || []).map(function (p) {
          return '<tr><td>' + esc(p.provider) + '</td><td>' + esc(p.label) + '</td><td><span class="tag tag-' + (p.configured ? 'ok' : 'warn') + '">' + (p.configured ? 'مُعد' : 'ناقص') + '</span></td></tr>';
        }).join('')
        + ((provs.providers || []).length ? '' : '<tr><td colspan="3" class="empty">لا مزوّدين</td></tr>')
        + '</tbody></table></div></div>';
    });
  }

  /* ==================== المفاتيح ==================== */
  var KEY_PROVIDERS = ['google', 'openrouter', 'groq', 'openai', 'anthropic', 'deepseek', 'mistral', 'omniroute'];
  function renderKeys() {
    var v = $('#view');
    v.innerHTML = ''
      + '<div class="toolbar"><input type="search" id="keySearch" placeholder="بحث…"><button class="btn" onclick="loadKeys()">↻</button><button class="btn btn-primary" onclick="window.__addKey()">+ مفتاح</button></div>'
      + '<div id="keyBody"><div class="empty">جاري التحميل…</div></div>';
    loadKeys();
    $('#keySearch').addEventListener('input', loadKeys);
  }
  function loadKeys() {
    var q = ($('#keySearch').value || '').trim().toLowerCase();
    F.api('/api/keys/pool').then(function (r) {
      var keys = r.keys || [];
      if (q) keys = keys.filter(function (k) { return (k.provider || '').toLowerCase().includes(q) || (k.label || '').toLowerCase().includes(q); });
      $('#keyBody').innerHTML = '<div class="card table-card"><table><thead><tr><th>المزوّد</th><th>التسمية</th><th>الحالة</th><th>المستخدم/الكوتة</th><th>المتبقي</th><th>إجراءات</th></tr></thead><tbody>'
        + keys.map(function (k) {
          var used = k.usedToday || 0, quota = k.quotaDaily || 0;
          var pct = quota ? Math.round(used / quota * 100) : 0;
          return '<tr><td>' + esc(k.provider) + '</td><td>' + esc(k.label || '—') + '</td>'
            + '<td><span class="tag tag-' + (k.enabled !== false ? 'ok' : 'mute') + '">' + (k.enabled !== false ? 'نشط' : 'معطّل') + '</span></td>'
            + '<td>' + fmtNum(used) + ' / ' + fmtNum(quota) + ' <div class="bar-lg" style="width:120px;margin-top:4px"><div class="bar-fill" style="width:' + Math.min(pct, 100) + '%"></div></div></td>'
            + '<td>' + fmtNum(Math.max(quota - used, 0)) + '</td>'
            + '<td><button class="btn btn-sm" onclick="window.__toggleKey(\'' + esc(k.id) + '\',' + (k.enabled !== false ? '0' : '1') + ')">' + (k.enabled !== false ? 'إيقاف' : 'تفعيل') + '</button> '
            + '<button class="btn btn-sm" onclick="window.__resetKey(\'' + esc(k.id) + '\')">تصفير</button> '
            + '<button class="btn btn-sm" onclick="window.__delKey(\'' + esc(k.id) + '\')">حذف</button></td></tr>';
        }).join('')
        + '</tbody></table></div>';
    });
  }
  window.__toggleKey = function (id, en) { F.api('/api/keys/pool/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: !!en } }).then(function () { F.toast('تم التحديث', 'ok'); loadKeys(); }); };
  window.__resetKey = function (id) { F.api('/api/keys/pool/' + encodeURIComponent(id) + '/reset', { method: 'POST' }).then(function () { F.toast('تم التصفير', 'ok'); loadKeys(); }); };
  window.__delKey = function (id) {
    if (!confirm('حذف المفتاح؟')) return;
    F.api('/api/keys/pool/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { F.toast('تم الحذف', 'ok'); loadKeys(); });
  };
  window.__addKey = function () {
    F.modal('<h3>إضافة مفتاح</h3><div class="form-grid">'
      + '<div class="field"><label>المزوّد</label><select id="kProv">' + KEY_PROVIDERS.map(function (p) { return '<option value="' + p + '"' + (p === 'google' ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>'
      + '<div class="field"><label>المفتاح</label><input id="kKey" placeholder="AIza… / sk-…"></div>'
      + '<div class="field"><label>التسمية</label><input id="kLabel" placeholder="اختياري"></div>'
      + '<div class="field"><label>الكوتة اليومية</label><input id="kQuota" type="number" value="1500"></div>'
      + '<div class="field full"><label>رابط المنشأ (اختياري)</label><input id="kBaseUrl" placeholder="https://api.example.com/v1"></div>'
      + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveKey()">حفظ</button></div>');
  };
  window.__saveKey = function () {
    var body = {
      provider: $('#kProv').value.trim(),
      key: $('#kKey').value.trim(),
      label: $('#kLabel').value.trim(),
      quotaDaily: Number($('#kQuota').value) || 1500,
      baseUrl: ($('#kBaseUrl') ? $('#kBaseUrl').value.trim() : '') || null
    };
    if (!body.key) { F.toast('المفتاح مطلوب', 'err'); return; }
    F.api('/api/keys/pool', { method: 'POST', body: body }).then(function (r) {
      if (r.ok) { F.toast('تمت الإضافة والمزامنة', 'ok'); F.closeModal(); loadKeys(); }
      else F.toast(r.error || 'فشل الإضافة', 'err');
    });
  };

  /* ==================== النماذج ==================== */
  function renderModels() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><input type="search" id="modelSearch" placeholder="بحث…"><select id="modelUsage"><option value="">كل الأنواع</option><option>text</option><option>image</option><option>vision</option></select><button class="btn" onclick="loadModels()">↻</button><button class="btn btn-primary" onclick="window.__addModel()">+ نموذج</button></div><div id="modelBody"><div class="empty">جاري التحميل…</div></div>';
    loadModels();
    $('#modelSearch').addEventListener('input', loadModels);
    $('#modelUsage').addEventListener('change', loadModels);
  }
  function loadModels() {
    var q = ($('#modelSearch').value || '').trim().toLowerCase();
    var usage = $('#modelUsage').value;
    F.api('/api/models').then(function (r) {
      var models = Array.isArray(r) ? r : [];
      models = models.filter(function (m) {
        if (usage && (m.usage || 'text') !== usage) return false;
        if (q && !(m.name || '').toLowerCase().includes(q) && !(m.id || '').toLowerCase().includes(q) && !(m.provider || '').toLowerCase().includes(q)) return false;
        return true;
      });
      $('#modelBody').innerHTML = '<div class="card table-card"><table><thead><tr><th>الاسم</th><th>المعرّف</th><th>المزوّد</th><th>النوع</th><th>التكلفة</th><th>الرؤية</th><th>تجريبي/حد</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>'
        + models.map(function (m) {
          const keyLink = m.keyId ? '<span class="tag tag-info" title="مرتبط بمفتاح">🔗 ' + esc(m.keyId) + '</span>' : '<span class="tag tag-mute">🔑 تلقائي</span>';
          const vis = m.visible === false ? '<span class="tag tag-warn">مخفي</span>' : '<span class="tag tag-ok">ظاهر</span>';
          const trial = m.trialDays ? '<span class="tag tag-warn">🧪 ' + esc(m.trialDays) + ' يوم</span>' : '';
          const limit = m.requestLimit ? '<span class="tag tag-mute">🧾 ' + fmtNum(m.requestLimit) + ' طلب</span>' : '';
          return '<tr><td>' + esc(m.name) + '</td><td>' + mon(m.id) + '</td><td>' + esc(m.provider) + '</td>'
            + '<td><span class="tag tag-info">' + esc(m.usage || 'text') + '</span> ' + keyLink + '</td>'
            + '<td>' + fmtUsd(m.costIn || 0) + '/' + fmtUsd(m.costOut || 0) + '</td>'
            + '<td>' + vis + '</td>'
            + '<td>' + (trial || '') + ' ' + (limit || '') + (trial || limit ? '' : '<span class="tag tag-mute">—</span>') + '</td>'
            + '<td><span class="tag tag-' + (m.active !== false ? 'ok' : 'mute') + '">' + (m.active !== false ? 'نشط' : 'معطّل') + '</span></td>'
            + '<td><button class="btn btn-sm" onclick="window.__toggleModel(\'' + esc(m.id) + '\',' + (m.active !== false ? 0 : 1) + ')">' + (m.active !== false ? 'إيقاف' : 'تفعيل') + '</button> '
            + '<button class="btn btn-sm" onclick="window.__editModel(\'' + esc(m.id) + '\')">تعديل</button> '
            + '<button class="btn btn-sm" onclick="window.__delModel(\'' + esc(m.id) + '\')">حذف</button></td></tr>';
        }).join('')
        + (models.length ? '' : '<tr><td colspan="9" class="empty">لا نماذج</td></tr>')
        + '</tbody></table></div>';
    });
  }
  window.__toggleModel = function (id, active) {
    F.api('/api/models/' + encodeURIComponent(id), { method: 'PUT', body: { active: !!active } }).then(function () { F.toast('تم التحديث', 'ok'); loadModels(); });
  };
  window.__delModel = function (id) {
    if (!confirm('حذف النموذج؟')) return;
    F.api('/api/models/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { F.toast('تم الحذف', 'ok'); loadModels(); });
  };
  window.__addModel = function () {
    F.api('/api/keys/pool').then(function (r) { state.data.keys = (r && r.keys) || []; F.modal(modelFormHtml(null)); });
  };
  window.__editModel = function (id) {
    F.api('/api/models').then(function (r) {
      var m = (Array.isArray(r) ? r : []).find(function (x) { return x.id === id; });
      if (!m) return;
      F.api('/api/keys/pool').then(function (kr) { state.data.keys = (kr && kr.keys) || []; F.modal(modelFormHtml(m)); });
    });
  };
  function modelKeyOptions(selected) {
    var keys = state.data.keys || [];
    var html = '<option value="">🔑 تلقائي (حسب المزوّد)' + (keys.length ? '' : ' — أضف مفتاحاً من «مفاتيح الصور» أولاً') + '</option>';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var sel = selected && (selected === k.id || selected === k.provider) ? ' selected' : '';
      html += '<option value="' + esc(k.id) + '"' + sel + '>' + esc(k.provider) + ' • ' + esc(k.label || k.id.slice(0, 8)) + '</option>';
    }
    return html;
  }
  function modelFormHtml(m) {
    return '<h3>' + (m ? 'تعديل النموذج' : 'إضافة نموذج') + '</h3><div class="form-grid">'
      + '<div class="field"><label>المعرّف</label><input id="moId" value="' + (m ? esc(m.id) : '') + '" ' + (m ? 'disabled' : '') + '></div>'
      + '<div class="field"><label>الاسم</label><input id="moName" value="' + (m ? esc(m.name) : '') + '"></div>'
      + '<div class="field"><label>المزوّد</label><input id="moProv" value="' + (m ? esc(m.provider) : '') + '"></div>'
      + '<div class="field"><label>النوع</label><select id="moUsage"><option value="text"' + ((!m || m.usage === 'text') ? ' selected' : '') + '>text</option><option value="image"' + ((m && m.usage === 'image') ? ' selected' : '') + '>image</option><option value="vision"' + ((m && m.usage === 'vision') ? ' selected' : '') + '>vision</option></select></div>'
      + '<div class="field full"><label>المفتاح الذي يعمل به هذا النموذج</label><select id="moKey">' + modelKeyOptions(m ? (m.keyId || m.keyProvider) : '') + '</select></div>'
      + '<div class="field"><label>العرض</label><input id="moCtx" type="number" value="' + (m ? (m.context || '') : '') + '" placeholder="اختياري"></div>'
      + '<div class="field"><label>أقصى مخرجات</label><input id="moMax" type="number" value="' + (m ? (m.maxOutput || '') : '') + '"></div>'
      + '<div class="field"><label>تكلفة الإدخال $</label><input id="moIn" type="number" step="0.0001" value="' + (m ? (m.costIn || 0) : 0) + '"></div>'
      + '<div class="field"><label>تكلفة الإخراج $</label><input id="moOut" type="number" step="0.0001" value="' + (m ? (m.costOut || 0) : 0) + '"></div>'
      + '<div class="field"><label>مدة تجريبية (أيام)</label><input id="moTrial" type="number" min="0" value="' + (m && m.trialDays ? m.trialDays : 0) + '" placeholder="0 = بلا تجربة"></div>'
      + '<div class="field"><label>عدد طلبات التجربة</label><input id="moTrialReq" type="number" min="0" value="' + (m && m.trialRequests ? m.trialRequests : 0) + '" placeholder="0 = غير محدود"></div>'
      + '<div class="field"><label>حد الطلبات الشهري</label><input id="moLimit" type="number" min="0" value="' + (m && m.requestLimit ? m.requestLimit : 0) + '" placeholder="0 = غير محدود"></div>'
      + '<div class="field full"><label>الوصف</label><input id="moDesc" value="' + (m ? esc(m.description) : '') + '"></div>'
      + '<div class="field full"><div style="display:flex;gap:18px;flex-wrap:wrap">'
      + '<label class="checkbox-field"><input type="checkbox" id="moFree" ' + (m && m.free ? 'checked' : '') + '> مجاني</label>'
      + '<label class="checkbox-field"><input type="checkbox" id="moVision" ' + (m && m.vision ? 'checked' : '') + '> رؤية</label>'
      + '<label class="checkbox-field"><input type="checkbox" id="moImage" ' + (m && m.image ? 'checked' : '') + '> توليد صور</label>'
      + '<label class="checkbox-field"><input type="checkbox" id="moVisible" ' + ((!m || m.visible !== false) ? 'checked' : '') + '> ظاهر للعملاء</label>'
      + '<label class="checkbox-field"><input type="checkbox" id="moActive" ' + ((!m || m.active !== false) ? 'checked' : '') + '> نشط</label>'
      + '</div></div>'
      + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveModel(\'' + (m ? esc(m.id) : '') + '\')">حفظ</button></div>';
  }
  window.__saveModel = function (id) {
    var body = {
      name: $('#moName').value.trim(),
      provider: $('#moProv').value.trim(),
      usage: $('#moUsage').value,
      context: Number($('#moCtx').value) || null,
      maxOutput: Number($('#moMax').value) || null,
      costIn: Number($('#moIn').value) || 0,
      costOut: Number($('#moOut').value) || 0,
      description: $('#moDesc').value,
      free: $('#moFree').checked,
      vision: $('#moVision').checked,
      image: $('#moImage').checked,
      keyId: $('#moKey').value || null,
      visible: $('#moVisible').checked,
      trialDays: Number($('#moTrial').value) || null,
      trialRequests: Number($('#moTrialReq').value) || null,
      requestLimit: Number($('#moLimit').value) || null,
      active: $('#moActive').checked,
    };
    if (!body.name || !body.provider) { F.toast('الاسم والمزوّد مطلوبان', 'err'); return; }
    if (!id) {
      var nid = $('#moId').value.trim();
      if (!nid) { F.toast('المعرّف مطلوب', 'err'); return; }
      F.api('/api/models', { method: 'POST', body: Object.assign({ id: nid }, body) }).then(handleModelSave);
    } else {
      F.api('/api/models/' + encodeURIComponent(id), { method: 'PUT', body: body }).then(handleModelSave);
    }
  };
  function handleModelSave(r) {
    if (r.ok || r.model) { F.toast('تم حفظ النموذج', 'ok'); F.closeModal(); loadModels(); }
    else F.toast(r.error || 'فشل الحفظ', 'err');
  }

  /* ==================== المزوّدون والبوابة ==================== */
  function renderProviders() {
    var v = $('#view');
    v.innerHTML = '<div class="grid-2">'
      + '<div class="card" id="provCard"><div class="card-head"><h3>مزوّدو الدردشة</h3></div><div id="provBody"><div class="empty">جاري التحميل…</div></div></div>'
      + '<div class="card"><div class="card-head"><h3>بوابة OmniRoute</h3></div><div id="gwBody"><div class="empty">جاري التحميل…</div></div></div>'
      + '</div>';
    loadProviders();
  }
  function loadProviders() {
    Promise.all([F.api('/api/tokens'), F.api('/api/gateway/status')]).then(function (res) {
      var tokens = Array.isArray(res[0]) ? res[0] : [];
      var gw = res[1] || {};
      $('#provBody').innerHTML = '<table><thead><tr><th>المزوّد</th><th>المفتاح</th><th>إجراء</th></tr></thead><tbody>'
        + tokens.map(function (t) {
          return '<tr><td>' + esc(t.provider) + '</td><td>' + mon(maskKey(t.key || '')) + '</td>'
            + '<td><button class="btn btn-sm" onclick="window.__delToken(\'' + esc(t.provider) + '\')">حذف</button></td></tr>';
        }).join('')
        + (tokens.length ? '' : '<tr><td colspan="3" class="empty">لا مزوّدين</td></tr>')
        + '</tbody></table>'
        + '<button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="window.__addToken()">+ إضافة مفتاح مزوّد</button>';
      var on = gw.running;
      $('#gwBody').innerHTML = '<div class="bar-row"><div class="br-head"><span>الحالة</span><span><span class="tag tag-' + (on ? 'ok' : 'danger') + '">' + (on ? 'تعمل' : 'متوقفة') + '</span></span></div></div>'
        + (gw.url ? '<div class="bar-row"><div class="br-head"><span>الرابط</span><span>' + mon(gw.url) + '</span></div></div>' : '')
        + '<div style="display:flex;gap:8px;margin-top:12px">'
        + '<button class="btn btn-sm" onclick="window.__gwAction(\'start\')">تشغيل</button>'
        + '<button class="btn btn-sm" onclick="window.__gwAction(\'stop\')">إيقاف</button>'
        + '<button class="btn btn-sm" onclick="window.__gwAction(\'restart\')">إعادة تشغيل</button>'
        + '</div>';
    });
  }
  function maskKey(k) {
    if (!k) return '—';
    if (String(k).length <= 12) return '••••';
    return k.slice(0, 6) + '••••' + k.slice(-4);
  }
  window.__delToken = function (provider) {
    if (!confirm('حذف مزوّد ' + provider + '؟')) return;
    F.api('/api/tokens/' + encodeURIComponent(provider), { method: 'DELETE' }).then(function () { F.toast('تم الحذف', 'ok'); loadProviders(); });
  };
  window.__addToken = function () {
    F.modal('<h3>إضافة مفتاح مزوّد</h3><div class="form-grid">'
      + '<div class="field"><label>المزوّد</label><input id="tkProv" placeholder="openrouter|google|groq…"></div>'
      + '<div class="field"><label>المفتاح</label><input id="tkKey" type="password" placeholder="sk-…"></div>'
      + '<div class="field full"><label>الرابط (اختياري)</label><input id="tkUrl" placeholder="https://…"></div>'
      + '</div><div class="modal-actions"><button class="btn" onclick="window.__closeModal()">إلغاء</button><button class="btn btn-primary" onclick="window.__saveToken()">حفظ</button></div>');
  };
  window.__saveToken = function () {
    var body = { provider: $('#tkProv').value.trim(), key: $('#tkKey').value.trim(), baseUrl: $('#tkUrl').value.trim() || null };
    if (!body.provider || !body.key) { F.toast('المزوّد والمفتاح مطلوبان', 'err'); return; }
    F.api('/api/tokens', { method: 'POST', body: body }).then(function (r) {
      if (r.ok) { F.toast('تم الحفظ والمزامنة', 'ok'); F.closeModal(); loadProviders(); loadTokensAdvanced(); }
      else F.toast(r.error || 'فشل الحفظ', 'err');
    });
  };
  window.__gwAction = function (act) {
    F.api('/api/gateway/' + act, { method: 'POST' }).then(function (r) {
      F.toast(r.message || 'تم تنفيذ العملية', 'ok');
      setTimeout(loadProviders, 1500);
    });
  };

  /* ==================== سجل التدقيق ==================== */
  function renderActivity() {
    var v = $('#view');
    v.innerHTML = '<div class="toolbar"><input type="search" id="actSearch" placeholder="بحث بالتفاصيل…"><select id="actAction"><option value="">كل الأحداث</option><option>model_add</option><option>model_update</option><option>model_delete</option><option>broadcast_add</option><option>subscription_update</option><option>settings_update</option><option>user_plan_upgrade</option></select><button class="btn" onclick="loadActivity()">↻</button></div><div id="actBody"><div class="empty">جاري التحميل…</div></div>';
    loadActivity();
    $('#actSearch').addEventListener('input', loadActivity);
    $('#actAction').addEventListener('change', loadActivity);
  }
  function loadActivity() {
    var q = ($('#actSearch').value || '').trim();
    var a = $('#actAction').value;
    var url = '/api/activity?' + (q ? 'q=' + encodeURIComponent(q) : '') + (a ? '&action=' + encodeURIComponent(a) : '') + '&limit=200';
    F.api(url).then(function (r) {
      var rows = Array.isArray(r) ? r : [];
      $('#actBody').innerHTML = '<div class="card table-card"><table><thead><tr><th>الحدث</th><th>التفاصيل</th><th>الوقت</th></tr></thead><tbody>'
        + rows.map(function (l) {
          return '<tr><td><span class="tag tag-info">' + mon(l.action) + '</span></td><td style="white-space:normal">' + esc(l.details) + '</td><td>' + fmtDate(l.time || l.created_at) + '</td></tr>';
        }).join('')
        + (rows.length ? '' : '<tr><td colspan="3" class="empty">لا سجلات مطابقة</td></tr>')
        + '</tbody></table></div>';
    });
  }

  /* ==================== الإعدادات ==================== */
  function renderSettings() {
    var v = $('#view');
    v.innerHTML = '<div id="setBody"><div class="empty">جاري التحميل…</div></div>';
    F.api('/api/settings/all').then(function (s) {
      s = s || {};
      v.innerHTML = '<div class="card"><div class="card-head"><h3>الإعدادات العامة</h3></div><div class="form-grid">'
        + '<div class="field full"><label>رابط مستودع GitHub (للمزامنة)</label><input id="sRepo" value="' + esc(s.githubRepo || '') + '" placeholder="https://github.com/…"></div>'
        + '<div class="field full"><label>رمز GitHub</label><input id="sToken" value="' + esc(s.githubToken || '') + '" type="password" placeholder="ghp_…"></div>'
        + '<div class="field"><label>استراتيجية التوجيه</label><select id="sRouting"><option value="auto"' + ((s.routingStrategy || 'auto') === 'auto' ? ' selected' : '') + '>تلقائي</option><option value="primary"' + (s.routingStrategy === 'primary' ? ' selected' : '') + '>أساسي فقط</option><option value="fallback"' + (s.routingStrategy === 'fallback' ? ' selected' : '') + '>احتياطي</option></select></div>'
        + '<div class="field"><label>وضع الضغط</label><select id="sComp"><option value="auto"' + ((s.compressionMode || 'auto') === 'auto' ? ' selected' : '') + '>تلقائي</option><option value="off"' + (s.compressionMode === 'off' ? ' selected' : '') + '>معطّل</option></select></div>'
        + '</div><div class="modal-actions"><button class="btn btn-primary" onclick="window.__saveSettings()">حفظ ومزامنة</button></div></div>'
        + '<div class="card"><div class="card-head"><h3>حالة المزامنة السحابية</h3></div><div style="display:flex;gap:10px;flex-wrap:wrap">'
        + '<button class="btn" onclick="window.__pushCloud()">↥ دفع النماذج إلى السحابة</button>'
        + '<button class="btn" onclick="window.__pullCloud()">↧ سحب النماذج من السحابة</button>'
        + '</div><div id="syncResult" style="margin-top:12px"></div</div>';
    });
  }
  window.__saveSettings = function () {
    var body = {
      githubRepo: $('#sRepo').value.trim(),
      githubToken: $('#sToken').value.trim(),
      routingStrategy: $('#sRouting').value,
      compressionMode: $('#sComp').value,
    };
    F.api('/api/settings/all', { method: 'POST', body: body }).then(function (r) {
      if (r.ok) F.toast('تم حفظ الإعدادات ومزامنتها سحابياً', 'ok');
      else F.toast(r.error || 'فشل الحفظ', 'err');
    });
  };
  window.__pushCloud = function () {
    F.api('/api/push/to-cloud', { method: 'POST' }).then(function (r) {
      $('#syncResult').innerHTML = '<div class="tag tag-ok">تم الدفع — Supabase: ' + ((r.results && r.results.supabase && r.results.supabase.synced) || 0) + ' نموذج</div>';
      F.toast('تم الدفع للسحابة', 'ok');
    });
  };
  window.__pullCloud = function () {
    F.api('/api/pull/from-cloud', { method: 'POST' }).then(function (r) {
      $('#syncResult').innerHTML = '<div class="tag tag-ok">تم السحب — استُورد: ' + ((r.results && r.results.supabase && r.results.supabase.imported) || 0) + '</div>';
      F.toast('تم السحب من السحابة', 'ok');
    });
  };

  /* ==================== الدخول ==================== */
  function initAuth() {
    // اللوحة مفتوحة مباشرة — لا مصادقة
  }

  /* ==================== الإقلاع ==================== */
  function boot() {
    initAuth();
    $('#adminApp').classList.remove('hidden');

    // مؤشر آخر تحديث
    var lastUpdated = document.createElement('div');
    lastUpdated.className = 'last-updated';
    lastUpdated.id = 'lastUpdated';
    lastUpdated.textContent = 'آخر تحديث: الآن';
    document.querySelector('.sidebar-footer').appendChild(lastUpdated);

    // الثيم
    var dt = document.documentElement.classList.contains('dark');
    $('#themeToggle').textContent = dt ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي';
    $('#themeToggle').onclick = function () {
      var dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('admin_theme', dark ? 'dark' : 'light');
      this.textContent = dark ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي';
    };

    // التنقل
    $$('.nav-item').forEach(function (b) {
      b.onclick = function () { navigate(b.dataset.section); };
    });
    $('#logoutBtn').onclick = function () {
      F.api('/api/auth/logout', { method: 'POST' }).then(function () {
        localStorage.removeItem('admin_token');
      }).catch(function () {});
    };
    $('#refreshAllBtn').onclick = function () { render(state.section); };
    $('#modalOverlay').onclick = function (e) { if (e.target === this) F.closeModal(); };

    // حالة البوابة
    F.api('/api/gateway/status').then(function (r) {
      var dot = $('#gwIndicator .gw-dot');
      dot.classList.toggle('on', !!r.running);
      dot.classList.toggle('off', !r.running);
      var txt = $('#gwIndicator span:last-child');
      txt.textContent = 'OmniRoute: ' + (r.running ? 'تعمل' : 'متوقفة');
    });

    // الإصدار
    F.api('/api/info').then(function (r) { $('#adminVersionFooter').textContent = 'v' + (r.version || '—'); });

    render('dashboard');
  }

  function render(section) {
    switch (section) {
      case 'dashboard': renderDashboard(); break;
      case 'analytics': renderAnalytics(); break;
      case 'subscribers': renderSubscribers(); break;
      case 'plans': renderPlans(); break;
      case 'broadcasts': renderBroadcasts(); break;
      case 'health': renderHealth(); break;
      case 'keys': renderKeys(); break;
      case 'models': renderModels(); break;
      case 'providers': renderProviders(); break;
      case 'activity': renderActivity(); break;
      case 'settings': renderSettings(); break;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
