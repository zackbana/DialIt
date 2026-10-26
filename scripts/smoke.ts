import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { prisma } from "../src/lib/prisma";
const url = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const sender = io(url, { transports: ["websocket"], autoConnect: false, reconnection: false });
const receiver = io(url, { transports: ["websocket"], autoConnect: false, reconnection: false });
const text = `smoke-${randomUUID()}`;
function connect(client: typeof sender) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);
    client.once("connect", () => { clearTimeout(timer); resolve(); });
    client.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    client.connect();
  });
}
async function main() {
try {
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", database: "sqlite" });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DialIt/);
  await Promise.all([connect(sender), connect(receiver)]);
  const invalid = await sender.timeout(5000).emitWithAck("message:create", "   ");
  assert.equal(invalid.ok, false);
  const received = new Promise<{ text: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Broadcast timeout")), 5000);
    receiver.on("message:created", (message) => {
      if (message.text === text) { clearTimeout(timer); resolve(message); }
    });
  });
  const ack = await sender.timeout(5000).emitWithAck("message:create", text);
  assert.equal(ack.ok, true);
  assert.equal((await received).text, text);
  const history = await fetch(`${url}/api/messages`);
  assert.equal(history.status, 200);
  const messages = await history.json() as { text: string }[];
  assert.ok(messages.some((message) => message.text === text));
  assert.equal(await prisma.message.count({ where: { text } }), 1);
  console.log("PASS: page, database health, WebSocket-only connection, validation, two-client broadcast, HTTP history, SQLite persistence");
} finally {
  sender.disconnect();
  receiver.disconnect();
  await prisma.message.deleteMany({ where: { text } });
  await prisma.$disconnect();
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
