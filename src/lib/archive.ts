import type Database from "better-sqlite3";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { hashToken, newToken } from "./auth";
import { configSchema } from "./protocol";
const id = z.string().uuid(), time = z.number().finite(), bit = z.union([z.literal(0), z.literal(1)]);
const json = z.string().max(200000).refine((value) => { try { JSON.parse(value); return true; } catch { return false; } }, "Invalid JSON field");
const config = json.refine((value) => configSchema.safeParse(JSON.parse(value)).success, "Invalid session/run configuration");
const state = z.enum(["preparing", "ready", "recording", "paused", "completed", "interrupted", "waiting"]);
const flags = json.refine((value) => z.array(z.string().max(60)).max(30).safeParse(JSON.parse(value)).success, "Invalid quality flags");
const run = z.object({ id, sessionId: id, clipId: id, config, practice: bit, state, version: z.number().int().min(1), positionMs: time.min(0), anchorAt: time, createdAt: time, endedAt: time.nullable() });
const schema = z.object({
  format: z.literal("dialit-session-v1"), exportedAt: time, mediaIncluded: z.literal(false),
  analysisOptions: z.object({ participants: z.array(id), groups: z.array(z.string().max(40)), opening: z.number().int().min(0).max(7200), window: z.number().int().min(1).max(600), minContributors: z.number().int().min(1).max(20), includeFlagged: z.boolean() }),
  project: z.object({ id, name: z.string().min(1).max(120), createdAt: time }),
  session: z.object({ id, projectId: id, name: z.string().min(1).max(120), code: z.string().regex(/^\d{6}$/), config, locked: bit, currentRunId: id.nullable(), createdAt: time }),
  clips: z.array(z.object({ id, projectId: id, title: z.string().min(1).max(120), filename: z.string().regex(/^[a-f0-9-]{36}\.mp4$/), durationMs: time.positive().max(7200000), bytes: z.number().int().positive(), metadata: json })),
  participants: z.array(z.object({ id, sessionId: id, label: z.string().max(80), groupTag: z.string().max(40), createdAt: time, telemetry: json })).max(20),
  runs: z.array(run),
  runParticipants: z.array(z.object({ runId: id, participantId: id, excluded: bit })),
  uploadReceipts: z.array(z.object({ runId: id, participantId: id, expectedRatings: z.number().int().min(0), expectedReactions: z.number().int().min(0), finalizedAt: time })),
  transitions: z.array(z.object({ id, runId: id, version: z.number().int().min(1), state, positionMs: time.min(0), serverAt: time, reason: z.string().max(1000) })),
  ratings: z.array(z.object({ runId: id, participantId: id, sequence: z.number().int().min(0), projectId: id, sessionId: id, clipId: id, value: time.min(0).max(100), videoMs: time.min(0), clientCapturedAt: time, capturedServerAt: time, receivedAt: time, sessionMs: time, playbackState: z.string().max(20), timingSource: z.enum(["display-anchor", "local-video"]), uncertaintyMs: time.min(0), flags, reconciledVideoMs: time.nullable() })),
  reactions: z.array(z.object({ id, runId: id, participantId: id, videoMs: time.min(0), clientCapturedAt: time, capturedServerAt: time, receivedAt: time, flags, capture: json, reconciledVideoMs: time.nullable() })),
  playback: z.array(z.object({ id, runId: id, participantId: id.nullable(), role: z.enum(["participant", "display"]), kind: z.string().max(40), positionMs: time.min(0), serverAt: time, capturedServerAt: time, details: json })),
  diagnostics: z.array(z.object({ id, sessionId: id, runId: id.nullable(), participantId: id.nullable(), kind: z.string().max(80), serverAt: time, details: json })),
});
export function validateSessionArchive(input: unknown) {
  const archive = schema.parse(input);
  const fail = () => { throw new Error("Archive contains out-of-scope or inconsistent IDs"); };
  const sid = archive.session.id, pid = archive.project.id;
  const runs = new Map(archive.runs.map((run) => [run.id, run])), participants = new Set(archive.participants.map((person) => person.id)), clips = new Set(archive.clips.map((clip) => clip.id));
  if (archive.session.projectId !== pid || (archive.session.currentRunId && !runs.has(archive.session.currentRunId))) fail();
  if (archive.clips.some((clip) => clip.projectId !== pid || clip.filename !== `${clip.id}.mp4`) || archive.participants.some((person) => person.sessionId !== sid) || archive.runs.some((run) => run.sessionId !== sid || !clips.has(run.clipId))) fail();
  for (const row of [...archive.runParticipants, ...archive.uploadReceipts, ...archive.ratings, ...archive.reactions]) if (!runs.has(row.runId) || !participants.has(row.participantId)) fail();
  for (const row of archive.ratings) if (row.projectId !== pid || row.sessionId !== sid || row.clipId !== runs.get(row.runId)!.clipId) fail();
  for (const row of [...archive.transitions, ...archive.playback]) if (!runs.has(row.runId)) fail();
  for (const row of [...archive.playback, ...archive.diagnostics]) if (row.participantId && !participants.has(row.participantId)) fail();
  for (const row of archive.diagnostics) if (row.sessionId !== sid || (row.runId && !runs.has(row.runId))) fail();
  return archive;
}
export function restoreSessionArchive(db: Database.Database, input: unknown, ownerId: string) {
  const archive = validateSessionArchive(input);
  if (!db.prepare("SELECT id FROM Moderator WHERE id=?").get(ownerId)) throw new Error("Choose an existing moderator as restored project owner");
  const insert = (table: string, rows: Record<string, unknown>[]) => {
    for (const row of rows) { const columns = Object.keys(row); db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((key) => row[key])); }
  };
  db.transaction(() => {
    if (db.prepare("SELECT id FROM Session WHERE id=? OR code=?").get(archive.session.id, archive.session.code)) throw new Error("Session ID or join code already exists; no existing data was overwritten");
    const project = db.prepare("SELECT name,ownerId FROM Project WHERE id=?").get(archive.project.id) as { name: string; ownerId: string } | undefined;
    if (project && (project.ownerId !== ownerId || project.name !== archive.project.name)) throw new Error("Project identity conflicts with the target database");
    if (!project) insert("Project", [{ ...archive.project, ownerId }]);
    for (const clip of archive.clips) {
      const existing = db.prepare("SELECT * FROM Clip WHERE id=?").get(clip.id) as Record<string, unknown> | undefined;
      if (existing && Object.entries(clip).some(([key, value]) => existing[key] !== value)) throw new Error("Clip identity conflicts with the target database");
      if (!existing) insert("Clip", [clip]);
    }
    insert("Session", [{ ...archive.session, displayTokenHash: null }]);
    insert("Participant", archive.participants.map((person) => ({ ...person, tokenHash: hashToken(newToken()), telemetry: "{}" })));
    insert("RecordingRun", archive.runs);
    insert("RunParticipant", archive.runParticipants);
    insert("RunUpload", archive.uploadReceipts);
    insert("RunTransition", archive.transitions);
    insert("Rating", archive.ratings); insert("Reaction", archive.reactions);
    insert("PlaybackEvent", archive.playback); insert("Diagnostic", archive.diagnostics);
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Archive foreign-key validation failed");
    for (const run of archive.runs.filter((run) => !["completed", "interrupted"].includes(run.state))) {
      const at = Date.now();
      db.prepare("UPDATE RecordingRun SET state='interrupted',version=version+1,endedAt=? WHERE id=?").run(at, run.id);
      insert("RunTransition", [{ id: randomUUID(), runId: run.id, version: run.version + 1, state: "interrupted", positionMs: run.positionMs, serverAt: at, reason: "Restored session archive; viewing interrupted" }]);
    }
  })();
  return archive.session.id;
}
