/* ============================================================
   jmf admin panel — Migration: OmniRoute Engine + Full Stats
   نسخه 3.5 — أعمدة الإحصاء الكامل + عمود image للنماذج
   شغّل هذا في Supabase SQL Editor بعد تحديث schema.sql
   ============================================================ */

-- 1) أعمدة الإحصاء الكامل في سجل الاستهلاك
ALTER TABLE key_usage ADD COLUMN IF NOT EXISTS model TEXT DEFAULT '';       -- معرف النموذج الفعلي
ALTER TABLE key_usage ADD COLUMN IF NOT EXISTS cost_usd NUMERIC DEFAULT 0;  -- تكلفة الطلب بالدولار
ALTER TABLE key_usage ADD COLUMN IF NOT EXISTS latency_ms INTEGER DEFAULT 0;-- زمن الاستجابة
ALTER TABLE key_usage ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ok';    -- ok | error | fallback

CREATE INDEX IF NOT EXISTS idx_key_usage_model ON key_usage(model, created_at);
CREATE INDEX IF NOT EXISTS idx_key_usage_status ON key_usage(status);

-- 2) عمود image لجدول النماذج (لتفعيل/تعطيل نماذج التوليد من اللوحة)
ALTER TABLE models ADD COLUMN IF NOT EXISTS image BOOLEAN DEFAULT FALSE;

-- 3) الدالة الموسّعة: تسجيل النموذج والتكلفة والزمن والحالة
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

  INSERT INTO key_usage (key_id, key_provider, user_id, user_email, kind, count, model, cost_usd, latency_ms, status)
  VALUES (p_key_id, v_provider, v_uid, v_email, p_kind, p_step, p_model, p_cost_usd, p_latency_ms, p_status);

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

GRANT EXECUTE ON FUNCTION increment_key_usage(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, NUMERIC, INTEGER, TEXT) TO anon, authenticated, service_role;