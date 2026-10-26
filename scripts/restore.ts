import "dotenv/config";
import { resolve } from "node:path";
import { restoreBackup } from "../src/lib/backup";
async function main() {
  if (!process.argv[2]) throw new Error("Usage: npm run restore -- /path/to/backup; stop the server first");
  const url = process.env.DATABASE_URL ?? "file:./data/dev.db";
  if (url === ":memory:") throw new Error("Restore requires a database file");
  await restoreBackup(resolve(process.argv[2]), resolve(url.startsWith("file:") ? url.slice(5) : url), resolve(process.env.MEDIA_DIR ?? "data/media"));
  console.log("Backup restored with original IDs and media. Start the server; any active viewing will be marked interrupted.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
