CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id),
    course VARCHAR NOT NULL DEFAULT 'business_analytics',
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_announcements_course
  ON announcements(course, is_active, created_at DESC);
