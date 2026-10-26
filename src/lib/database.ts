import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Message { id: string; text: string; createdAt: string }
export function openDatabase(url = process.env.DATABASE_URL ?? "file:./data/dev.db") {
  const filename = url.startsWith("file:") ? url.slice(5) : url;
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db: Database.Database, directory = resolve("db/migrations")) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL
  )`);
  db.transaction(() => {
    for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
      const sql = readFileSync(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = db.prepare("SELECT checksum FROM _migrations WHERE name = ?").get(name) as { checksum: string } | undefined;
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, checksum) VALUES (?, ?)").run(name, checksum);
    }
  })();
}

export function createMessage(db: Database.Database, text: string): Message {
  const message = { id: randomUUID(), text, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO Message (id, text, createdAt) VALUES (@id, @text, @createdAt)').run(message);
  return message;
}

export function listMessages(db: Database.Database): Message[] {
  const rows = db.prepare('SELECT id, text, createdAt FROM Message ORDER BY createdAt DESC, rowid DESC LIMIT 50').all() as Message[];
  return rows.reverse().map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
}
