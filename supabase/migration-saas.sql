/* ============================================================
   jmf admin panel — SaaS ميجريشن (إعلانات البث + سجل التدقيق)
   شغّل هذا في Supabase SQL Editor بعد schema.sql
   ============================================================ */

-- جدول إعلانات البث (من اللوحة إلى جميع المستخدمين)
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_active ON broadcasts(active, priority);

-- جدول سجل التدقيق الموحّد (كل اللوحات/الخوادم)
CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL DEFAULT '',
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action, created_at);

-- تمكين RLS
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- سياسات واسعة للتطوير (التطبيق يستخدم service-role)
DROP POLICY IF EXISTS "Allow all for authenticated" ON broadcasts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON activity_log;

CREATE POLICY "Allow all for authenticated" ON broadcasts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON activity_log
  FOR ALL USING (true) WITH CHECK (true);
