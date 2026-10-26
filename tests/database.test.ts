import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate, createMessage, listMessages } from "../src/lib/database";

test("migrations preserve data on repeat and messages survive reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "dialit-db-"));
  const filename = join(directory, "test.db");
  let db = openDatabase(filename);
  try {
    migrate(db);
    const message = createMessage(db, "A quote: ' and Unicode: 你好");
    migrate(db);
    db.close();
    db = openDatabase(filename);
    migrate(db);
    assert.deepEqual(listMessages(db), [message]);
    for (let i = 0; i < 55; i++) createMessage(db, `message-${i}`);
    const history = listMessages(db);
    assert.equal(history.length, 50);
    assert.equal(history.at(-1)?.text, "message-54");
    assert.ok(!history.some((item) => item.id === message.id));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("failed migration rolls back and applied SQL cannot be silently changed", () => {
  const directory = mkdtempSync(join(tmpdir(), "dialit-migration-"));
  const db = openDatabase(":memory:");
  try {
    const file = join(directory, "001.sql");
    writeFileSync(file, "CREATE TABLE sample (id TEXT); INVALID SQL;");
    assert.throws(() => migrate(db, directory));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sample'").get(), undefined);
    writeFileSync(file, "CREATE TABLE sample (id TEXT);");
    migrate(db, directory);
    writeFileSync(file, "DROP TABLE sample;");
    assert.throws(() => migrate(db, directory), /Applied migration changed/);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sample'").get());
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
