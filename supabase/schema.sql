/* ============================================================
   jmf admin panel — Supabase Schema
   شغّل هذا في Supabase SQL Editor بعد إنشاء المشروع
   النسخة 3.0 — إدارة مفاتيح الصور بالكوتة + توزيع الأحمال + الاشتراكات
   ============================================================ */

-- جدول النماذج (Models)
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  context INTEGER,
  max_output INTEGER,
  cost_in NUMERIC,
  cost_out NUMERIC,
  free BOOLEAN DEFAULT FALSE,
  vision BOOLEAN DEFAULT FALSE,
  video BOOLEAN DEFAULT FALSE,
  image BOOLEAN DEFAULT FALSE,
  usage TEXT DEFAULT 'text',
  active BOOLEAN DEFAULT TRUE,
  description TEXT DEFAULT '',
  visible BOOLEAN DEFAULT TRUE,
  key_id TEXT DEFAULT NULL,
  trial_days INTEGER DEFAULT NULL,
  trial_requests INTEGER DEFAULT NULL,
  request_limit INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- عمود نوع الاستخدام (text/image/vision) — للتحكم بإظهار/إخفاء النموذج في قائمة المحادثة
ALTER TABLE models ADD COLUMN IF NOT EXISTS usage TEXT DEFAULT 'text';

-- ترقية جدول النماذج القائم (إن لم تكن أعمدة جديدة موجودة بعد)
ALTER TABLE models ADD COLUMN IF NOT EXISTS image BOOLEAN DEFAULT FALSE;

-- إدارة النماذج: الربط بالمفتاح + الرؤية للعملاء + التجربة + حد الطلبات
ALTER TABLE models ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT TRUE;
ALTER TABLE models ADD COLUMN IF NOT EXISTS key_id TEXT DEFAULT NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS trial_requests INTEGER DEFAULT NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS request_limit INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_models_visible ON models(visible);

-- جدول التوكنات (Tokens)
CREATE TABLE IF NOT EXISTS tokens (
  provider TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  base_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول الإعدادات (Settings)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

/* ============================================================
   جدول مفاتيح واجهة البرمجة (مجمّع المفاتيح — الكوتة اليومية)
   المصدر السحابي الوحيد الذي تُزامن معه جميع أجهزة المستخدمين
   ============================================================ */
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider TEXT NOT NULL DEFAULT 'google',
  label TEXT DEFAULT '',
  key TEXT NOT NULL,
  base_url TEXT,
  quota_daily INTEGER NOT NULL DEFAULT 1500,
  used_today INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ترقية جدول موجود سابقاً بأعمدة الكوتة (إن لم تكن موجودة بعد)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label TEXT DEFAULT '';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS quota_daily INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS used_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_reset TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- توحيد نوع معرّف المفتاح على TEXT (في الجداول القديمة كان uuid فيتعذّر إدراج معرفات 'key_…')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='api_keys' AND column_name='id' AND data_type='uuid'
  ) THEN
    ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_pkey;
    ALTER TABLE api_keys ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE api_keys ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;
    ALTER TABLE api_keys ADD PRIMARY KEY (id);
  END IF;
END $$;

-- فهرس للتوزيع السريع (الأقل استهلاكاً)
CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);
CREATE INDEX IF NOT EXISTS idx_api_keys_usage ON api_keys(enabled, used_today);

/* ============================================================
   سجل استهلاك المفاتيح (طلب بالتفصيل)
   ============================================================ */
CREATE TABLE IF NOT EXISTS key_usage (
  id BIGSERIAL PRIMARY KEY,
  key_id TEXT,
  key_provider TEXT DEFAULT 'google',
  user_id TEXT DEFAULT '',
  user_email TEXT DEFAULT '',
  kind TEXT DEFAULT 'image',   -- image | vision | chat
  count INTEGER DEFAULT 1,
  model TEXT DEFAULT '',       -- معرف النموذج الفعلي المستخدم
  cost_usd NUMERIC DEFAULT 0,  -- التكلفة الفعلية بالدولار للطلب
  latency_ms INTEGER DEFAULT 0, -- زمن الاستجابة بالمللي ثانية
  status TEXT DEFAULT 'ok',    -- ok | error | fallback
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_key_usage_key ON key_usage(key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_key_usage_user ON key_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_key_usage_model ON key_usage(model, created_at);
CREATE INDEX IF NOT EXISTS idx_key_usage_status ON key_usage(status);

/* ============================================================
   ملفات المستخدمين (الخطة + استهلاك الصور)
   كل مستخدم للتطبيق له سجل هنا بمجرد أول طلب
   ============================================================ */
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,          -- deviceId أو معرف Supabase auth
  email TEXT DEFAULT '',
  plan TEXT DEFAULT 'free',          -- free | pro | premium (اشتراكات مستقبلية)
  images_today INTEGER DEFAULT 0,
  images_total INTEGER DEFAULT 0,
  vision_today INTEGER DEFAULT 0,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_plan ON user_profiles(plan);

/* ============================================================
   الاشتراكات المدفوعة (إدراج مستقبلي — تحضير للبنية فقط)
   سيتم تفعيلها لاحقاً لتشغيل خدمات مميزة
   ============================================================ */
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'inactive',     -- inactive | active | canceled | past_due
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

/* ============================================================
   دالة زيادة الاستهلاك ذرّياً (تُستدعى من التطبيق بعد كل توليد)
   — تصفّر الكوتة يومياً تلقائياً
   ============================================================ */
CREATE OR REPLACE FUNCTION increment_key_usage(
  p_key_id TEXT,
  p_user_id TEXT DEFAULT '',
  p_user_email TEXT DEFAULT '',
  p_kind TEXT DEFAULT 'image',
  p_step INTEGER DEFAULT 1,
  p_model TEXT DEFAULT '',
  p_cost_usd NUMERIC DEFAULT 0,
  p_latency_ms INTEGER DEFAULT 0,
  p_status TEXT DEFAULT 'ok'
) RETURNS JSONB AS $$
DECLARE
rec api_keys%ROWTYPE;
  today_start TIMESTAMPTZ := date_trunc('day', now());
  v_provider TEXT := 'google';
  v_used_today BIGINT := 0;
  v_quota_daily INTEGER := 0;
  v_uid TEXT;
  v_email TEXT;
BEGIN
  -- 1) تحديث عدّاد المفتاح (مع تصفير تلقائي عند بدء يوم جديد)
  UPDATE api_keys
     SET used_today = CASE
            WHEN last_reset IS NULL OR last_reset < today_start THEN p_step
            ELSE used_today + p_step
          END,
         last_reset = CASE
            WHEN last_reset IS NULL OR last_reset < today_start THEN today_start
            ELSE last_reset
          END,
         updated_at = now()
   WHERE id::text = p_key_id
     AND enabled = TRUE
  RETURNING * INTO rec;

  -- 2) قيم آمنة حتى لو كان المفتاح غير معروف أو معطّلاً (أو p_key_id فارغاً)
  IF rec.id IS NOT NULL THEN
    v_provider := rec.provider;
    v_used_today := rec.used_today;
    v_quota_daily := rec.quota_daily;
  ELSE
    SELECT provider, used_today, quota_daily
      INTO v_provider, v_used_today, v_quota_daily
      FROM api_keys WHERE id::text = p_key_id;
    IF v_provider IS NULL THEN v_provider := 'google'; END IF;
  END IF;

  v_uid := COALESCE(NULLIF(p_user_id, ''), 'anon');
  v_email := COALESCE(NULLIF(p_user_email, ''), '');

  -- 3) تسجيل الطلب في السجل حتى وإن لم يُعرف المفتاح (مع النموذج والتكلفة والزمن والحالة)
  INSERT INTO key_usage (key_id, key_provider, user_id, user_email, kind, count, model, cost_usd, latency_ms, status)
  VALUES (p_key_id, v_provider, v_uid, v_email, p_kind, p_step, p_model, p_cost_usd, p_latency_ms, p_status);

  -- 4) تحديث ملف المستخدم
  INSERT INTO user_profiles (user_id, email, plan, images_total, images_today, last_reset)
  VALUES (v_uid, v_email, 'free',
          CASE WHEN p_kind = 'image' THEN p_step ELSE 0 END,
          CASE WHEN p_kind = 'image' THEN p_step ELSE 0 END,
          today_start)
  ON CONFLICT (user_id) DO UPDATE SET
    email = CASE WHEN v_email <> '' THEN v_email ELSE user_profiles.email END,
    images_total = user_profiles.images_total + CASE WHEN p_kind = 'image' THEN p_step ELSE 0 END,
    images_today = CASE
        WHEN user_profiles.last_reset IS NULL OR user_profiles.last_reset < today_start
             THEN CASE WHEN p_kind = 'image' THEN p_step ELSE 0 END
        ELSE user_profiles.images_today + CASE WHEN p_kind = 'image' THEN p_step ELSE 0 END
        END,
    vision_today = CASE
        WHEN user_profiles.last_reset IS NULL OR user_profiles.last_reset < today_start
             THEN CASE WHEN p_kind = 'vision' THEN p_step ELSE 0 END
        ELSE user_profiles.vision_today + CASE WHEN p_kind = 'vision' THEN p_step ELSE 0 END
        END,
    last_reset = CASE
        WHEN user_profiles.last_reset IS NULL OR user_profiles.last_reset < today_start
             THEN today_start
        ELSE user_profiles.last_reset
        END,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', TRUE,
    'used_today', v_used_today,
    'quota_daily', v_quota_daily,
    'remaining', GREATEST(v_quota_daily - v_used_today, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/* ============================================================
   دالة تصفير الكوتة يدوياً من لوحة التحكم
   ============================================================ */
CREATE OR REPLACE FUNCTION reset_key_usage(p_key_id TEXT)
RETURNS JSONB AS $$
DECLARE rec api_keys%ROWTYPE;
BEGIN
  UPDATE api_keys SET used_today = 0, last_reset = now(), updated_at = now()
   WHERE id::text = p_key_id RETURNING * INTO rec;
  RETURN jsonb_build_object('ok', TRUE, 'id', p_key_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تفويض استدعاء الدوال عبر PostgREST (Data API — للوحات والتطبيق)
GRANT EXECUTE ON FUNCTION increment_key_usage(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, NUMERIC, INTEGER, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION reset_key_usage(TEXT) TO anon, authenticated, service_role;

/* ============================================================
   إدراج الإعدادات الافتراضية
   ============================================================ */
INSERT INTO settings (key, value) VALUES
  ('github', '{"repo": "", "token": ""}')
ON CONFLICT (key) DO NOTHING;

-- تفعيل Row Level Security (RLS)
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول (التطبيق يستخدم SERVICE_ROLE_KEY لذلك تُستخدم للتطوير فقط)
DROP POLICY IF EXISTS "Allow all for authenticated" ON models;
DROP POLICY IF EXISTS "Allow all for authenticated" ON tokens;
DROP POLICY IF EXISTS "Allow all for authenticated" ON settings;
DROP POLICY IF EXISTS "Allow all for authenticated" ON api_keys;
DROP POLICY IF EXISTS "Allow all for authenticated" ON key_usage;
DROP POLICY IF EXISTS "Allow all for authenticated" ON user_profiles;
DROP POLICY IF EXISTS "Allow all for authenticated" ON subscriptions;

CREATE POLICY "Allow all for authenticated" ON models
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON tokens
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON settings
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON api_keys
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON key_usage
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON user_profiles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON subscriptions
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes للأداء
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_active ON models(active);
CREATE INDEX IF NOT EXISTS idx_tokens_provider ON tokens(provider);