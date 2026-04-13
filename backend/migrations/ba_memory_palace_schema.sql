-- Table 1: Master memory node per student per topic
CREATE TABLE IF NOT EXISTS ba_memory_palace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES users(id),
    topic_id VARCHAR NOT NULL REFERENCES topics(id),
    understanding_summary TEXT,
    misconceptions JSONB DEFAULT '[]',
    effective_examples JSONB DEFAULT '[]',
    forge_attempts JSONB DEFAULT '[]',
    personal_connections JSONB DEFAULT '[]',
    p_known FLOAT DEFAULT 0.0,
    mastery_level VARCHAR DEFAULT 'unassessed',
    last_studied_at TIMESTAMP,
    session_count INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, topic_id)
);

-- Table 2: Individual memory fragments (specific moments)
CREATE TABLE IF NOT EXISTS ba_memory_fragments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES users(id),
    topic_id VARCHAR REFERENCES topics(id),
    palace_id UUID REFERENCES ba_memory_palace(id),
    fragment_type VARCHAR NOT NULL,
    -- values: 'insight' | 'confusion' | 'example_worked' |
    --         'forge_attempt' | 'case_connection' | 'formula_used'
    content TEXT NOT NULL,
    source_session_id INTEGER REFERENCES chat_sessions(id),
    metadata JSONB DEFAULT '{}',
    vector_id VARCHAR,
    embedded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table 3: Async Dream agent processing queue
CREATE TABLE IF NOT EXISTS ba_dream_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL,
    session_id INTEGER NOT NULL,
    status VARCHAR DEFAULT 'pending',
    -- values: 'pending' | 'processing' | 'done' | 'failed'
    topics_touched JSONB DEFAULT '[]',
    raw_summary TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    error TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ba_memory_palace_user
  ON ba_memory_palace(user_id);
CREATE INDEX IF NOT EXISTS idx_ba_memory_palace_user_topic
  ON ba_memory_palace(user_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_ba_memory_fragments_user
  ON ba_memory_fragments(user_id);
CREATE INDEX IF NOT EXISTS idx_ba_memory_fragments_palace
  ON ba_memory_fragments(palace_id);
CREATE INDEX IF NOT EXISTS idx_ba_dream_queue_status
  ON ba_dream_queue(status);
CREATE INDEX IF NOT EXISTS idx_ba_dream_queue_user
  ON ba_dream_queue(user_id);
