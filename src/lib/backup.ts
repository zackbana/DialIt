import type Database from "better-sqlite3";
import Sqlite from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, copyFile, lstat, readdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { z } from "zod";
const manifestSchema = z.object({ format: z.literal("dialit-backup-v1"), createdAt: z.string(), mediaIncluded: z.literal(true), files: z.array(z.object({ name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1) });
async function checksum(path: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
function validName(name: string) { return name === "database.sqlite" || /^media\/[a-f0-9-]{36}\.mp4$/.test(name); }
export async function backup(db: Database.Database, media: string, destination: string) {
  await mkdir(destination, { recursive: false, mode: 0o700 });
  try {
    await mkdir(join(destination, "media"), { mode: 0o700 });
    const target = join(destination, "database.sqlite");
    await db.backup(target);
    const snapshot = new Sqlite(target, { readonly: true });
    let clips: { filename: string }[];
    try { clips = snapshot.prepare("SELECT filename FROM Clip").all() as { filename: string }[]; } finally { snapshot.close(); }
    const names = ["database.sqlite"];
    for (const clip of clips) {
      const name = `media/${clip.filename}`;
      if (!validName(name)) throw new Error("Unsafe media filename in database");
      if (!(await lstat(join(media, clip.filename))).isFile()) throw new Error(`Missing/unsafe media: ${clip.filename}`);
      await copyFile(join(media, clip.filename), join(destination, name)); names.push(name);
    }
    const files = await Promise.all(names.map(async (name) => ({ name, sha256: await checksum(join(destination, name)) })));
    await writeFile(join(destination, "manifest.json"), JSON.stringify({ format: "dialit-backup-v1", createdAt: new Date().toISOString(), mediaIncluded: true, files }, null, 2), { mode: 0o600 });
    return files.length;
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
}
export async function validateBackup(source: string) {
  const info = await lstat(join(source, "manifest.json"));
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Invalid backup manifest");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(source, "manifest.json"), "utf8")));
  if (!(await lstat(join(source, "media"))).isDirectory()) throw new Error("Backup media must be a real directory, not a symlink");
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (!validName(file.name) || names.has(file.name)) throw new Error("Unsafe or duplicate archive path");
    names.add(file.name);
    const path = resolve(source, file.name);
    if (!(await lstat(path)).isFile() || await checksum(path) !== file.sha256) throw new Error(`Backup checksum failed: ${file.name}`);
  }
  if (!names.has("database.sqlite")) throw new Error("Database absent from backup");
  const db = new Sqlite(join(source, "database.sqlite"), { readonly: true });
  try {
    const check = db.pragma("integrity_check", { simple: true });
    if (check !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Backup database integrity failed");
    const clips = db.prepare("SELECT filename FROM Clip").all() as { filename: string }[];
    if (clips.some((clip) => !names.has(`media/${clip.filename}`))) throw new Error("Backup media manifest incomplete");
    db.prepare("SELECT id,state FROM RecordingRun").all();
  } finally { db.close(); }
  return manifest;
}
export async function restoreBackup(source: string, databaseFile: string, media: string) {
  const manifest = await validateBackup(source);
  try { await lstat(databaseFile); throw new Error("Refusing to overwrite an existing database. Restore into an empty data directory with the server stopped."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { if ((await readdir(media)).length) throw new Error("Refusing to overwrite a nonempty media directory"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(databaseFile), { recursive: true, mode: 0o700 });
  await mkdir(media, { recursive: true, mode: 0o700 });
  for (const file of manifest.files.filter((entry) => entry.name !== "database.sqlite")) await copyFile(join(source, file.name), join(media, file.name.slice(6)));
  // Database is installed last so an incomplete copy never looks ready to start.
  await copyFile(join(source, "database.sqlite"), databaseFile);
}
