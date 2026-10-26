import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../src/lib/database";
import { hashPassword } from "../src/lib/auth";
async function main() {
  const directory = mkdtempSync(join(tmpdir(), "dialit-browser-test-"));
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.PORT = "3100"; process.env.HOST = "127.0.0.1";
  const db = openDatabase(); migrate(db);
  db.prepare("INSERT INTO Moderator VALUES (?,?,?,'admin',?)").run(randomUUID(), "browser-test", await hashPassword("isolated-browser-test-password"), Date.now()); db.close();
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  await import("../server");
}
main().catch((error) => { console.error(error); process.exit(1); });
