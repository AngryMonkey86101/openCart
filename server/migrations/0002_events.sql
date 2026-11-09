-- Журнал изменений списка для оповещений: кто что добавил, купил или вернул в список.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('added', 'done', 'undone')),
  item_title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX events_family ON events(family_id, id);
