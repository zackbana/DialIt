import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { openDatabase, migrate, createMessage, listMessages } from "./src/lib/database";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const app = next({ dev: process.env.NODE_ENV !== "production", hostname, port });
  const db = openDatabase();
  migrate(db);
  await app.prepare();
  const api = express();
  api.disable("x-powered-by");
  const http = createServer(api);
  const io = new Server(http, { maxHttpBufferSize: 4096 });

  api.get("/api/health", async (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", database: "sqlite" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  api.get("/api/messages", async (_req, res) => {
    try {
      const messages = listMessages(db);
      res.json(messages);
    } catch {
      res.status(503).json({ error: "Unable to load messages" });
    }
  });
  io.on("connection", (socket) => {
    socket.on("message:create", async (text: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      if (typeof text !== "string" || !text.trim() || text.trim().length > 500) {
        ack({ ok: false, error: "Enter 1–500 characters" });
        return;
      }
      try {
        const message = createMessage(db, text.trim());
        io.emit("message:created", message);
        ack({ ok: true });
      } catch {
        ack({ ok: false, error: "Unable to save message" });
      }
    });
  });
  api.use((req, res) => { void app.getRequestHandler()(req, res); });
  http.listen(port, hostname, () => console.log(`DialIt listening on port ${port}`));
  http.on("error", (error) => { console.error(error); process.exit(1); });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    io.close(() => {
      db.close();
      void app.close().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((error) => { console.error(error); process.exit(1); });
