import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate } from "../src/lib/database";

test("product migrations preserve project identities and data on repeat and reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "dialit-db-"));
  const filename = join(directory, "test.db");
  let db = openDatabase(filename);
  try {
    migrate(db);
    const project = { id: "project-test", ownerId: "owner-test", name: "A quote: ' and Unicode: 你好", createdAt: 1234 };
    db.prepare("INSERT INTO Moderator VALUES ('owner-test','test-user','not-a-real-credential','admin',1234)").run();
    db.prepare("INSERT INTO Project VALUES (@id,@ownerId,@name,@createdAt)").run(project);
    migrate(db); db.close(); db = openDatabase(filename); migrate(db);
    assert.deepEqual(db.prepare("SELECT * FROM Project").get(), project);
    assert.equal((db.prepare("SELECT count(*) n FROM RecordingRun").get() as { n: number }).n, 0);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
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
