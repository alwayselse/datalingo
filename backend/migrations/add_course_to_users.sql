ALTER TABLE users
ADD COLUMN IF NOT EXISTS course VARCHAR(50) DEFAULT 'data_science';

UPDATE users
SET course = 'data_science'
WHERE course IS NULL;

ALTER TABLE topics
ADD COLUMN IF NOT EXISTS course VARCHAR(50) DEFAULT 'data_science';

UPDATE topics
SET course = 'data_science'
WHERE course IS NULL;
