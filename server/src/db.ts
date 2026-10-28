import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export function openDatabase(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Применяет по порядку SQL-файлы из migrations/, которые ещё не применялись. */
function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM _migrations").pluck().all() as string[]);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
    })();
  }
}
