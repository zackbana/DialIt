import "dotenv/config";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../src/lib/database";
import { hashPassword } from "../src/lib/auth";
async function main() {
  const index = process.argv.indexOf("--username");
  const username = index >= 0 ? process.argv[index + 1] : "admin";
  if (!username || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)) throw new Error("Username must be 3–80 letters, numbers, _, . or -");
  let password = process.env.DIALIT_ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) throw new Error("Set DIALIT_ADMIN_PASSWORD securely, or run interactively to enter a hidden password");
    process.stdout.write("Password (12–200 characters; hidden): ");
    process.stdin.setRawMode(true);
    password = await new Promise<string>((resolve, reject) => {
      let text = "";
      const onData = (data: Buffer) => {
        for (const char of data.toString()) {
          if (char === "\u0003") { process.stdin.off("data", onData); reject(new Error("Cancelled")); return; }
          if (char === "\r" || char === "\n") { process.stdin.off("data", onData); resolve(text); return; }
          if (char === "\u007f") text = text.slice(0, -1);
          else if (char >= " ") text += char;
        }
      };
      process.stdin.on("data", onData); process.stdin.resume();
    }).finally(() => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); });
  }
  const passwordHash = await hashPassword(password);
  const db = openDatabase(); migrate(db);
  try {
    if (db.prepare("SELECT id FROM Moderator WHERE username=?").get(username)) throw new Error("Account already exists; no account was overwritten");
    db.prepare("INSERT INTO Moderator VALUES (?,?,?,'admin',?)").run(randomUUID(), username, passwordHash, Date.now());
    console.log(`Created administrator ${username}`);
  } finally { db.close(); }
}
// No passwords are accepted as command-line arguments or written to logs.
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
