import "dotenv/config";
import { statSync, readFileSync } from "node:fs";
import { openDatabase, migrate } from "../src/lib/database";
import { restoreSessionArchive } from "../src/lib/archive";
function main() {
  const path = process.argv[2], index = process.argv.indexOf("--owner"), username = process.argv[index + 1];
  if (!path || index < 0 || !username) throw new Error("Usage: npm run session:restore -- archive.json --owner admin (stop the server first)");
  if (statSync(path).size > 512 * 1024 * 1024) throw new Error("Archive is too large for JSON import; use a full database/media backup");
  const input = JSON.parse(readFileSync(path, "utf8")), db = openDatabase(); migrate(db);
  try {
    const owner = db.prepare("SELECT id FROM Moderator WHERE username=?").get(username) as { id: string } | undefined;
    if (!owner) throw new Error("Create the target moderator account first");
    const id = restoreSessionArchive(db, input, owner.id);
    console.log(`Restored session ${id}. IDs preserved; media is not included. Copy original media files and issue new scoped display/participant links before reuse.`);
  } finally { db.close(); }
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
