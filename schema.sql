CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  bio           VARCHAR(240) DEFAULT '',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(160) NOT NULL,
  content     TEXT         NOT NULL DEFAULT '',
  category    VARCHAR(40)  NOT NULL DEFAULT 'General',
  tags        TEXT[]       NOT NULL DEFAULT '{}',
  color       VARCHAR(12)  NOT NULL DEFAULT 'sand',
  priority    SMALLINT     NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2),
  pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
  favorite    BOOLEAN      NOT NULL DEFAULT FALSE,
  archived    BOOLEAN      NOT NULL DEFAULT FALSE,
  trashed     BOOLEAN      NOT NULL DEFAULT FALSE,
  reminder_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user     ON notes(user_id, trashed, archived);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(user_id, category);
