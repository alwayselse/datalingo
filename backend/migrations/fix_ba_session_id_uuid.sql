-- Convert BA memory session_id columns from legacy integer to UUID-string-compatible text.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'ba_dream_queue'
          AND column_name = 'session_id'
          AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
        EXECUTE '
            ALTER TABLE ba_dream_queue
            ALTER COLUMN session_id TYPE VARCHAR
            USING session_id::VARCHAR
        ';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'ba_memory_fragments'
          AND column_name = 'source_session_id'
          AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
        EXECUTE '
            ALTER TABLE ba_memory_fragments
            ALTER COLUMN source_session_id TYPE VARCHAR
            USING source_session_id::VARCHAR
        ';
    END IF;
END $$;
