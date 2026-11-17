-- Событие «переименовал(а) список»: в item_title хранится новое название.
-- В SQLite CHECK не меняется через ALTER, поэтому таблица пересоздаётся с теми же данными.
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('added', 'done', 'undone', 'renamed')),
  item_title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO events_new (id, family_id, actor_id, type, item_title, created_at)
  SELECT id, family_id, actor_id, type, item_title, created_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_family ON events(family_id, id);
