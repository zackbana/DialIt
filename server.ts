import "dotenv/config";
import next from "next";
import { resolve } from "node:path";
import { openDatabase, migrate } from "./src/lib/database";
import { createBackend } from "./src/lib/backend";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const db = openDatabase();
  migrate(db);
  const backend = createBackend(db, resolve(process.env.MEDIA_DIR ?? "data/media"));
  const app = next({ dev: process.env.NODE_ENV !== "production", hostname, port });
  await app.prepare();
  backend.api.use(backend.errors);
  backend.api.use((req, res) => { void app.getRequestHandler()(req, res); });
  backend.http.listen(port, hostname, () => console.log(`DialIt listening on port ${port}`));
  backend.http.on("error", (error) => { console.error(error); process.exit(1); });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    void backend.close().then(async () => { db.close(); await app.close(); process.exit(0); });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((error) => { console.error(error); process.exit(1); });
