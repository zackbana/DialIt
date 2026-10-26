import "dotenv/config";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { openDatabase, migrate } from "../src/lib/database";
import { backup } from "../src/lib/backup";
async function main() {
  const destination = resolve(process.argv[2] ?? `backups/dialit-${new Date().toISOString().replaceAll(":", "-")}`);
  await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  const db = openDatabase(); migrate(db);
  try { console.log(`Backup complete: ${await backup(db, resolve(process.env.MEDIA_DIR ?? "data/media"), destination)} files. Keep this directory private; it contains credentials and research data.`); }
  finally { db.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
