CREATE TABLE users (
  id INTEGER PRIMARY KEY,          -- Telegram user id
  first_name TEXT NOT NULL,
  username TEXT,
  chat_id INTEGER                  -- известен после /start, нужен для уведомлений
);

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, user_id)
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  qty TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER NOT NULL REFERENCES users(id),
  done_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX items_family ON items(family_id, done, created_at);
