import express, { type Request, type ErrorRequestHandler } from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type Database from "better-sqlite3";
import { randomUUID, randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdirSync, renameSync, unlinkSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { cookieValue, hashToken, newToken, verifyPassword } from "./auth";
import { configSchema, sampleSchema, reactionSchema, telemetrySchema, type Run, type SessionConfig, type Snapshot, type Telemetry, type Role, type Sample } from "./protocol";
import { analyse, csv, analysisOptionsFromQuery, type AnalysisRating, type AnalysisReaction } from "./analysis";

type SessionRow = { id: string; projectId: string; name: string; code: string; config: string; locked: number; displayTokenHash: string | null; currentRunId: string | null; createdAt: number };
type RunRow = Omit<Run, "config" | "practice"> & { config: string; practice: number };
type Participant = { id: string; sessionId: string; tokenHash: string; label: string; groupTag: string; telemetry: string; createdAt: number };
type Moderator = { id: string; username: string; passwordHash: string; role: string };
type ClipRow = { id: string; projectId: string; title: string; filename: string; durationMs: number; bytes: number; metadata: string };
type Identity = { role: Role; sessionId: string; participantId?: string; moderatorId?: string };
type Live = Telemetry & { sockets: Set<string>; lastPlaybackAt?: number; lastAdvanceAt?: number; ended?: boolean };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const requireThat: (test: unknown, message: string, status?: number) => asserts test = (test, message, status = 400) => { if (!test) throw new HttpError(status, message); };
const exec = promisify(execFile);
const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);
const terminal = new Set(["completed", "interrupted"]);
export function createBackend(db: Database.Database, mediaDirectory: string) {
  mkdirSync(mediaDirectory, { recursive: true });
  const api = express();
  api.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") api.set("trust proxy", 1);
  api.use(express.json({ limit: "1mb" }));
  api.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin && origin !== `${req.protocol}://${req.get("host")}` && origin !== process.env.PUBLIC_ORIGIN) {
      next(new HttpError(403, "Cross-origin mutation rejected")); return;
    }
    next();
  });
  const http = createServer(api);
  const io = new Server(http, { maxHttpBufferSize: 512 * 1024, allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, !origin || origin === process.env.PUBLIC_ORIGIN || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`);
  } });
  const baseWall = Date.now(), baseMono = performance.now();
  const now = () => baseWall + performance.now() - baseMono;
  const get = <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T | undefined;
  const all = <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[];
  const put = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);
  const live = new Map<string, Live>();
  const identities = new Map<string, Identity>();
  const runFor = (session: SessionRow): Run | null => {
    const raw = session.currentRunId && get<RunRow>("SELECT * FROM RecordingRun WHERE id = ?", session.currentRunId);
    return raw ? { ...raw, config: JSON.parse(raw.config), practice: Boolean(raw.practice) } : null;
  };
  const sessionFor = (id: string) => {
    const session = get<SessionRow>("SELECT * FROM Session WHERE id = ?", id);
    requireThat(session, "Session not found", 404); return session;
  };
  const getRun = (id: string) => {
    const raw = get<RunRow>("SELECT * FROM RecordingRun WHERE id = ?", id);
    requireThat(raw, "Recording run not found", 404);
    return { ...raw, config: JSON.parse(raw.config) as SessionConfig, practice: Boolean(raw.practice) };
  };
  const moderatorFrom = (header?: string) => {
    const token = cookieValue(header, "dialit_auth");
    return token ? get<Moderator>("SELECT m.* FROM Moderator m JOIN AuthSession a ON a.moderatorId=m.id WHERE a.tokenHash=? AND a.expiresAt>?", hashToken(token), now()) : undefined;
  };
  const requireModerator = (req: Request) => {
    const moderator = moderatorFrom(req.headers.cookie);
    requireThat(moderator, "Moderator login required", 401); return moderator;
  };
  const checkProject = (moderator: Moderator, projectId: string) => {
    const project = get<{ id: string; ownerId: string }>("SELECT id,ownerId FROM Project WHERE id=?", projectId);
    requireThat(project && (moderator.role === "admin" || project.ownerId === moderator.id), "Project access denied", 403);
  };
  const moderatorSession = (req: Request, sid: string) => {
    const moderator = requireModerator(req), session = sessionFor(sid);
    checkProject(moderator, session.projectId); return session;
  };
  const authenticate = (sid: string, role: Role, token: string, cookie?: string): Identity => {
    const session = sessionFor(sid);
    if (role === "moderator") {
      const moderator = moderatorFrom(cookie);
      requireThat(moderator, "Moderator login required", 401);
      checkProject(moderator, session.projectId);
      return { role, sessionId: sid, moderatorId: moderator.id };
    }
    requireThat(token.length >= 32 && token.length <= 100, "Invalid device credential", 401);
    if (role === "display") {
      requireThat(session.displayTokenHash === hashToken(token), "Display access denied", 403);
      return { role, sessionId: sid };
    }
    const participant = get<Participant>("SELECT * FROM Participant WHERE sessionId=? AND tokenHash=?", sid, hashToken(token));
    requireThat(participant, "Participant access denied", 403);
    return { role: "participant", sessionId: sid, participantId: participant.id };
  };
  const requestIdentity = (req: Request, sid: string) => {
    if (moderatorFrom(req.headers.cookie)) return authenticate(sid, "moderator", "", req.headers.cookie);
    const token = req.get("authorization")?.replace(/^Bearer /, "") ?? String(req.query.token ?? "");
    const role = req.query.role === "display" ? "display" : "participant";
    return authenticate(sid, role, token);
  };
  const keyFor = (identity: Identity) => identity.role === "participant" ? identity.participantId! : `${identity.role}:${identity.sessionId}`;
  const emptyLive = (): Live => ({ ready: false, visible: true, positionMs: 0, pending: 0, latencyMs: 0, driftMs: 0, error: "", buffered: 0, lastContact: 0, connected: false, sockets: new Set() });
  const device = (identity: Identity) => {
    const key = keyFor(identity);
    if (!live.has(key)) live.set(key, emptyLive());
    return live.get(key)!;
  };
  const publicTelemetry = (value?: Live): Partial<Telemetry> => {
    if (!value) return { connected: false, ready: false, error: "Not connected" };
    const { sockets: _sockets, ...rest } = value;
    void _sockets; return rest;
  };
  const clipFor = (run: Run | null) => run ? get<ClipRow>("SELECT * FROM Clip WHERE id=?", run.clipId)! : null;
  const timeline = (run: Run, at = now()) => Math.min(clipFor(run)!.durationMs, Math.max(0, run.positionMs + (run.state === "recording" ? Math.max(0, at - run.anchorAt) : 0)));
  const participantsFor = (session: SessionRow, run: Run | null) => all<Participant>("SELECT * FROM Participant WHERE sessionId=? ORDER BY createdAt", session.id).map((person) => ({
    id: person.id, label: person.label, groupTag: person.groupTag,
    excluded: Boolean(run && get<{ excluded: number }>("SELECT excluded FROM RunParticipant WHERE runId=? AND participantId=?", run.id, person.id)?.excluded),
    telemetry: live.has(person.id) ? publicTelemetry(live.get(person.id)) : { ...JSON.parse(person.telemetry), connected: false, ready: false } as Partial<Telemetry>,
  }));
  const participantReconciled = (run: Run, participantId: string) => {
    if (!terminal.has(run.state)) return false;
    const receipt = get<{ expectedRatings: number; expectedReactions: number }>("SELECT * FROM RunUpload WHERE runId=? AND participantId=?", run.id, participantId);
    if (!receipt) return false;
    const ratings = get<{ n: number; next: number }>("SELECT count(*) n,COALESCE(max(sequence)+1,0) next FROM Rating WHERE runId=? AND participantId=?", run.id, participantId)!;
    const reactions = get<{ n: number }>("SELECT count(*) n FROM Reaction WHERE runId=? AND participantId=?", run.id, participantId)!;
    return ratings.n === receipt.expectedRatings && ratings.next === receipt.expectedRatings && reactions.n === receipt.expectedReactions;
  };
  const uploadsReconciled = (run: Run) => terminal.has(run.state) && all<{ participantId: string }>("SELECT participantId FROM RunParticipant WHERE runId=? AND excluded=0", run.id).every((person) => participantReconciled(run, person.participantId));
  const snapshot = (identity: Identity): Snapshot => {
    const session = sessionFor(identity.sessionId), run = runFor(session), clip = clipFor(run);
    const state: Snapshot = { id: session.id, name: session.name, locked: Boolean(session.locked), config: run?.config ?? JSON.parse(session.config), run, clip: clip ? { id: clip.id, title: clip.title, durationMs: clip.durationMs, bytes: clip.bytes } : null, serverAt: now(), timelineMs: run ? timeline(run) : 0 };
    if (identity.role === "display") state.code = session.code;
    if (identity.role === "moderator") {
      if (run) state.lastTransition = get<{ reason: string; serverAt: number }>("SELECT reason,serverAt FROM RunTransition WHERE runId=? ORDER BY version DESC LIMIT 1", run.id);
      state.code = session.code; state.participants = participantsFor(session, run);
      state.display = publicTelemetry(live.get(`display:${session.id}`));
      if (run) {
        const counts = get<{ samples: number; flagged: number }>("SELECT count(*) samples, COALESCE(sum(flags!='[]'),0) flagged FROM Rating WHERE runId=?", run.id)!;
        const pending = state.participants.reduce((sum, person) => sum + (person.telemetry.pending ?? 0), 0);
        state.quality = { ...counts, reactions: get<{ n: number }>("SELECT count(*) n FROM Reaction WHERE runId=?", run.id)!.n, pending, provisional: !uploadsReconciled(run) };
      }
    }
    if (identity.participantId) {
      const person = get<Participant>("SELECT * FROM Participant WHERE id=?", identity.participantId)!;
      state.participant = { uploadsReconciled: run ? participantReconciled(run, person.id) : false, id: person.id, label: person.label, groupTag: person.groupTag, excluded: Boolean(run && get<{ excluded: number }>("SELECT excluded FROM RunParticipant WHERE runId=? AND participantId=?", run.id, person.id)?.excluded) };
    }
    return state;
  };
  const broadcast = (sid: string) => {
    for (const [socketId, identity] of identities) if (identity.sessionId === sid) io.sockets.sockets.get(socketId)?.emit("state", snapshot(identity));
  };
  const diagnostic = (sid: string, runId: string | null, kind: string, details: unknown, participantId?: string) => put("INSERT INTO Diagnostic VALUES (?,?,?,?,?,?,?)", randomUUID(), sid, runId, participantId ?? null, kind, now(), JSON.stringify(details));
  const transition = (run: Run, state: Run["state"], reason: string, delay = 0) => {
    const at = now() + delay, position = timeline(run);
    if (state === "paused") for (const [key, status] of live) if (key.endsWith(run.sessionId) || get("SELECT id FROM Participant WHERE id=? AND sessionId=?", key, run.sessionId)) status.ready = false;
    db.transaction(() => {
      put("UPDATE RecordingRun SET state=?,version=version+1,positionMs=?,anchorAt=?,endedAt=? WHERE id=?", state, position, at, terminal.has(state) ? at : null, run.id);
      put("INSERT INTO RunTransition VALUES (?,?,?,?,?,?,?)", randomUUID(), run.id, run.version + 1, state, position, at, reason);
    })();
    broadcast(run.sessionId);
  };
  const safePause = (sid: string, reason: string) => {
    const run = runFor(sessionFor(sid));
    if (run?.state === "recording") transition(run, "paused", reason);
  };
  // A process restart always terminates the previous clock/timeline; collected rows remain immutable.
  for (const raw of all<RunRow>("SELECT * FROM RecordingRun WHERE state IN ('preparing','ready','recording','paused')")) {
    const last = get<{ positionMs: number }>("SELECT positionMs FROM PlaybackEvent WHERE runId=? AND role IN ('display','participant') ORDER BY serverAt DESC LIMIT 1", raw.id);
    transition({ ...raw, state: "paused", positionMs: last?.positionMs ?? raw.positionMs, config: JSON.parse(raw.config), practice: Boolean(raw.practice) }, "interrupted", "Server restarted; explicit new viewing required");
  }
  const required = (session: SessionRow, run: Run) => participantsFor(session, run).filter((person) => !person.excluded);
  const readyCheck = (session: SessionRow, run: Run) => {
    const people = required(session, run);
    return people.length > 0 && people.every((person) => person.telemetry.connected && person.telemetry.ready && person.telemetry.visible && !person.telemetry.error) && (run.config.mode !== "shared" || (() => { const display = live.get(`display:${session.id}`); return display?.connected && display.ready && display.visible && !display.error; })());
  };
  const updateReady = (sid: string) => {
    const session = sessionFor(sid), run = runFor(session);
    if (!run || !["preparing", "ready"].includes(run.state)) return;
    const ready = readyCheck(session, run);
    if (ready && run.state === "preparing") transition(run, "ready", "All included devices ready");
    if (!ready && run.state === "ready") transition(run, "preparing", "A required device is no longer ready");
  };
  const control = (session: SessionRow, input: unknown) => {
    const { action, version } = z.object({ action: z.enum(["start", "pause", "resume", "end"]), version: z.number().int() }).parse(input);
    const run = runFor(session); requireThat(run, "Prepare a viewing first");
    requireThat(version === run.version, "Stale command; refresh state and try again", 409);
    if (action === "start") { requireThat(run.state === "ready" && readyCheck(session, run), "All devices must be ready"); transition(run, "recording", "Moderator start", 1500); }
    if (action === "pause") { requireThat(run.state === "recording", "Run is not recording"); transition(run, "paused", "Moderator pause"); }
    if (action === "resume") { requireThat(run.state === "paused" && readyCheck(session, run), "Tap Ready on all included devices before resuming"); transition(run, "recording", "Moderator resume", 1500); }
    if (action === "end") { requireThat(!terminal.has(run.state), "Run already ended"); transition(run, "completed", "Moderator ended viewing"); }
    return getRun(run.id);
  };
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const joinLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  api.get("/api/health", (_req, res) => { db.prepare("SELECT 1").get(); res.json({ status: "ok", database: "sqlite" }); });
  api.post("/api/auth/login", loginLimit, async (req, res) => {
    const body = z.object({ username: z.string().max(100), password: z.string().max(200) }).parse(req.body);
    const moderator = get<Moderator>("SELECT * FROM Moderator WHERE username=?", body.username);
    // Use a real scrypt operation even for unknown accounts.
    const dummy = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await verifyPassword(body.password, moderator?.passwordHash ?? dummy);
    requireThat(moderator && valid, "Invalid username or password", 401);
    const token = newToken();
    put("DELETE FROM AuthSession WHERE expiresAt<=?", now());
    put("INSERT INTO AuthSession VALUES (?,?,?)", hashToken(token), moderator.id, now() + 12 * 3600000);
    res.cookie("dialit_auth", token, { httpOnly: true, sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" || req.secure, maxAge: 12 * 3600000, path: "/" });
    res.json({ username: moderator.username, role: moderator.role });
  });
  api.get("/api/auth/me", (req, res) => { const person = requireModerator(req); res.json({ username: person.username, role: person.role }); });
  api.post("/api/auth/logout", (req, res) => {
    const token = cookieValue(req.headers.cookie, "dialit_auth");
    if (token) put("DELETE FROM AuthSession WHERE tokenHash=?", hashToken(token));
    for (const [socketId, identity] of identities) if (identity.role === "moderator" && cookieValue(io.sockets.sockets.get(socketId)?.request.headers.cookie, "dialit_auth") === token) io.sockets.sockets.get(socketId)?.disconnect(true);
    res.clearCookie("dialit_auth", { path: "/" }); res.json({ ok: true });
  });
  api.get("/api/projects", (req, res) => {
    const person = requireModerator(req);
    const projects = person.role === "admin" ? all("SELECT * FROM Project ORDER BY createdAt DESC") : all("SELECT * FROM Project WHERE ownerId=? ORDER BY createdAt DESC", person.id);
    const sessions = all<SessionRow>("SELECT * FROM Session ORDER BY createdAt DESC").filter((session) => { try { checkProject(person, session.projectId); return true; } catch { return false; } }).map((session) => ({ id: session.id, name: session.name, projectId: session.projectId, code: session.code }));
    res.json({ projects, sessions });
  });
  api.post("/api/projects", (req, res) => {
    const person = requireModerator(req), name = nameSchema.parse(req.body.name), id = randomUUID();
    put("INSERT INTO Project VALUES (?,?,?,?)", id, person.id, name, now()); res.status(201).json({ id, name });
  });
  api.post("/api/sessions", (req, res) => {
    const person = requireModerator(req);
    const body = z.object({ projectId: idSchema, name: nameSchema, config: configSchema.optional() }).parse(req.body);
    checkProject(person, body.projectId);
    const id = randomUUID(); let code = "";
    do { code = String(randomInt(100000, 1000000)); } while (get("SELECT id FROM Session WHERE code=?", code));
    put("INSERT INTO Session VALUES (?,?,?,?,?,0,NULL,NULL,?)", id, body.projectId, body.name, code, JSON.stringify(body.config ?? configSchema.parse({})), now());
    res.status(201).json({ id, code });
  });
  api.post("/api/join", joinLimit, (req, res) => {
    const body = z.object({ code: z.string().regex(/^\d{6}$/), groupTag: z.string().max(40).default("") }).parse(req.body);
    const session = get<SessionRow>("SELECT * FROM Session WHERE code=?", body.code);
    requireThat(session, "Session code not found", 404);
    const run = runFor(session);
    requireThat(!session.locked && (!run || terminal.has(run.state) || ["waiting", "preparing"].includes(run.state)), "New entry is locked for this viewing", 409);
    const config = configSchema.parse(JSON.parse(session.config));
    requireThat(!body.groupTag || config.groups.includes(body.groupTag), "Select a configured group tag");
    const count = get<{ n: number }>("SELECT count(*) n FROM Participant WHERE sessionId=?", session.id)!.n;
    requireThat(count < 20, "This session already has 20 participant identities", 409);
    const id = randomUUID(), token = newToken(), label = `P${String(count + 1).padStart(2, "0")}`;
    db.transaction(() => {
      put("INSERT INTO Participant (id,sessionId,tokenHash,label,groupTag,createdAt) VALUES (?,?,?,?,?,?)", id, session.id, hashToken(token), label, body.groupTag, now());
      if (run && !terminal.has(run.state)) put("INSERT INTO RunParticipant VALUES (?,?,0)", run.id, id);
    })();
    broadcast(session.id); res.status(201).json({ sessionId: session.id, participantId: id, label, token });
  });
  api.get("/api/join/:code", joinLimit, (req, res) => {
    const code = z.string().regex(/^\d{6}$/).parse(req.params.code);
    const session = get<SessionRow>("SELECT * FROM Session WHERE code=?", code);
    requireThat(session, "Session code not found", 404);
    res.json({ id: session.id, name: session.name, groups: configSchema.parse(JSON.parse(session.config)).groups });
  });
  api.get("/api/sessions/:sid/state", (req, res) => res.json(snapshot(requestIdentity(req, String(req.params.sid)))));
  api.get("/api/sessions/:sid/manage", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid));
    res.json({ ...snapshot({ role: "moderator", sessionId: session.id }), projectId: session.projectId, nextConfig: JSON.parse(session.config), clips: all<ClipRow>("SELECT * FROM Clip WHERE projectId=?", session.projectId).map(({ filename: _f, ...clip }) => { void _f; return clip; }), runs: all<RunRow>("SELECT * FROM RecordingRun WHERE sessionId=? ORDER BY createdAt DESC", session.id).map((run) => ({ ...run, config: JSON.parse(run.config), practice: Boolean(run.practice) })) });
  });
  api.patch("/api/sessions/:sid", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid)), run = runFor(session);
    const body = z.object({ config: configSchema.optional(), locked: z.boolean().optional() }).parse(req.body);
    if (body.config) { requireThat(!run || terminal.has(run.state), "Finish the current run before changing configuration", 409); put("UPDATE Session SET config=? WHERE id=?", JSON.stringify(body.config), session.id); }
    if (body.locked !== undefined) put("UPDATE Session SET locked=? WHERE id=?", Number(body.locked), session.id);
    broadcast(session.id); res.json({ ok: true });
  });
  api.post("/api/sessions/:sid/display-token", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid)), run = runFor(session);
    requireThat(!run || terminal.has(run.state) || run.state === "preparing", "Cannot rotate display access during a ready or active run", 409);
    const token = newToken(); put("UPDATE Session SET displayTokenHash=? WHERE id=?", hashToken(token), session.id);
    for (const [socketId, identity] of identities) if (identity.sessionId === session.id && identity.role === "display") io.sockets.sockets.get(socketId)?.disconnect(true);
    res.json({ token });
  });
  api.post("/api/sessions/:sid/participants/:pid/credential", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid)), run = runFor(session);
    requireThat(!run || terminal.has(run.state), "End the viewing before replacing a device credential; preserve the original browser’s pending queue", 409);
    const person = get<Participant>("SELECT * FROM Participant WHERE id=? AND sessionId=?", req.params.pid, session.id);
    requireThat(person, "Participant not found", 404);
    const token = newToken(); put("UPDATE Participant SET tokenHash=? WHERE id=?", hashToken(token), person.id);
    for (const [socketId, identity] of identities) if (identity.participantId === person.id) io.sockets.sockets.get(socketId)?.disconnect(true);
    diagnostic(session.id, run?.id ?? null, "credential-replaced", { label: person.label }, person.id);
    broadcast(session.id); res.json({ sessionId: session.id, participantId: person.id, label: person.label, token });
  });
  api.post("/api/sessions/:sid/runs", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid)), prior = runFor(session);
    requireThat(!prior || terminal.has(prior.state), "End the current run first", 409);
    const body = z.object({ clipId: idSchema, practice: z.boolean() }).parse(req.body);
    requireThat(get<ClipRow>("SELECT * FROM Clip WHERE id=? AND projectId=?", body.clipId, session.projectId), "Select a clip in this project");
    const id = randomUUID(), at = now();
    db.transaction(() => {
      put("INSERT INTO RecordingRun VALUES (?,?,?,?,?,'preparing',1,0,?,?,NULL)", id, session.id, body.clipId, session.config, Number(body.practice), at, at);
      put("UPDATE Session SET currentRunId=? WHERE id=?", id, session.id);
      put("INSERT INTO RunParticipant SELECT ?,id,0 FROM Participant WHERE sessionId=?", id, session.id);
      put("INSERT INTO RunTransition VALUES (?,?,1,'preparing',0,?,?)", randomUUID(), id, at, "New viewing prepared");
    })();
    for (const [key, status] of live) if (key.endsWith(session.id) || get<Participant>("SELECT id FROM Participant WHERE id=? AND sessionId=?", key, session.id)) { status.ready = false; status.error = ""; status.positionMs = 0; status.ended = false; status.lastAdvanceAt = now(); }
    broadcast(session.id); res.status(201).json(getRun(id));
  });
  api.post("/api/sessions/:sid/control", (req, res) => res.json(control(moderatorSession(req, String(req.params.sid)), req.body)));
  api.post("/api/sessions/:sid/participants/:pid/exclude", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid)), run = runFor(session);
    requireThat(run && ["preparing", "ready", "paused"].includes(run.state), "Exclusions may change only while preparing or paused", 409);
    const excluded = z.boolean().parse(req.body.excluded);
    const result = put("UPDATE RunParticipant SET excluded=? WHERE runId=? AND participantId=?", Number(excluded), run.id, req.params.pid);
    requireThat(result.changes, "Participant not in run", 404);
    diagnostic(session.id, run.id, "participant-exclusion", { excluded }, String(req.params.pid));
    updateReady(session.id); broadcast(session.id); res.json({ ok: true });
  });
  const upload = multer({ dest: mediaDirectory, limits: { fileSize: Math.min(Number(process.env.MAX_UPLOAD_MB ?? 500), 2000) * 1024 * 1024, files: 1, fields: 1 } });
  api.post("/api/projects/:pid/clips", (req, _res, next) => { checkProject(requireModerator(req), String(req.params.pid)); next(); }, upload.single("video"), async (req, res) => {
    const file = req.file; requireThat(file, "Choose an MP4 video");
    try {
      const title = nameSchema.parse(req.body.title || file.originalname);
      const fd = openSync(file.path, "r"); const magic = Buffer.alloc(12);
      try { readSync(fd, magic, 0, 12, 0); } finally { closeSync(fd); }
      requireThat(magic.subarray(4, 8).toString() === "ftyp", "File is not an MP4 container");
      const { stdout } = await exec(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json", file.path], { timeout: 15000, maxBuffer: 1024 * 1024 });
      const metadata = JSON.parse(stdout) as { format: { duration: string; format_name: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string }[] };
      const durationMs = Number(metadata.format.duration) * 1000;
      const video = metadata.streams.filter((stream) => stream.codec_type === "video");
      requireThat(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 7200000 && metadata.format.format_name.includes("mp4"), "Video duration/container not supported");
      requireThat(video.length === 1 && video[0].codec_name === "h264" && video[0].pix_fmt === "yuv420p" && (video[0].width ?? 0) <= 3840 && (video[0].height ?? 0) <= 2160 && metadata.streams.filter((stream) => stream.codec_type === "audio").every((stream) => stream.codec_name === "aac"), "Use one H.264 yuv420p video stream (up to 3840×2160) and optional AAC audio");
      const id = randomUUID(), filename = `${id}.mp4`;
      renameSync(file.path, resolve(mediaDirectory, filename));
      put("INSERT INTO Clip VALUES (?,?,?,?,?,?,?)", id, req.params.pid, title, filename, durationMs, file.size, JSON.stringify(metadata));
      res.status(201).json({ id, title, durationMs, bytes: file.size });
    } catch (error) {
      try { unlinkSync(file.path); } catch { /* already moved or removed */ }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(503, "ffprobe is required on the server; install FFmpeg and retry");
      if (error instanceof HttpError || error instanceof z.ZodError) throw error;
      throw new HttpError(400, "Video metadata validation failed; use a valid H.264/AAC MP4");
    }
  });
  api.get("/api/clips/:cid/media", (req, res) => {
    const clip = get<ClipRow>("SELECT * FROM Clip WHERE id=?", req.params.cid);
    requireThat(clip, "Clip not found", 404);
    const moderator = moderatorFrom(req.headers.cookie);
    if (moderator) checkProject(moderator, clip.projectId);
    else {
      const identity = requestIdentity(req, String(req.query.sessionId ?? "")), session = sessionFor(identity.sessionId), run = runFor(session);
      requireThat(run?.clipId === clip.id && (identity.role === "display" || run.config.mode === "individual"), "Media access denied", 403);
    }
    const path = resolve(mediaDirectory, clip.filename);
    requireThat(clip.filename === `${clip.id}.mp4`, "Invalid media path", 500);
    try { statSync(path); } catch { throw new HttpError(404, "Media file is missing; restore the uploaded-media backup"); }
    res.type("video/mp4"); res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(path, { acceptRanges: true, cacheControl: false });
  });

  function analyseRun(req: Request, run: Run) {
    const session = moderatorSession(req, run.sessionId);
    const options = analysisOptionsFromQuery(req.query);
    const participants = all<Participant & { excluded: number }>("SELECT p.*,rp.excluded FROM Participant p JOIN RunParticipant rp ON rp.participantId=p.id WHERE rp.runId=?", run.id);
    const allowed = new Set(participants.filter((person) => !person.excluded && (!options.participants.length || options.participants.includes(person.id)) && (!options.groups.length || options.groups.includes(person.groupTag))).map((person) => person.id));
    const ratings = all<AnalysisRating & Record<string, unknown>>("SELECT * FROM Rating WHERE runId=? ORDER BY participantId,sequence", run.id);
    const reactions = all<AnalysisReaction & Record<string, unknown>>("SELECT * FROM Reaction WHERE runId=? ORDER BY videoMs", run.id).map((row) => ({ ...JSON.parse(String(row.capture)), ...row }));
    const result = analyse(ratings.map((row) => ({ ...row, videoMs: typeof row.reconciledVideoMs === "number" ? row.reconciledVideoMs : row.videoMs })), reactions.map((row) => ({ ...row, videoMs: typeof row.reconciledVideoMs === "number" ? row.reconciledVideoMs : row.videoMs })), options, allowed, clipFor(run)!.durationMs);
    const missing = result.bins.filter((bin) => bin.n < allowed.size).length;
    const transitions = all<{ state: string; serverAt: number; positionMs: number; reason: string }>("SELECT * FROM RunTransition WHERE runId=? ORDER BY version", run.id);
    const playback = all<{ role: string; participantId: string | null; capturedServerAt: number; positionMs: number; kind: string }>("SELECT * FROM PlaybackEvent WHERE runId=? ORDER BY serverAt", run.id);
    const observedDrifts: number[] = [];
    if (run.config.mode === "individual") for (const report of playback) {
      if (report.role !== "participant" || !report.participantId || !allowed.has(report.participantId) || !["tick", "playing"].includes(report.kind) || report.positionMs < options.opening * 1000) continue;
      const transition = transitions.filter((entry) => entry.serverAt <= report.capturedServerAt).at(-1);
      if (transition?.state !== "recording") continue;
      observedDrifts.push(Math.abs(report.positionMs - Math.min(clipFor(run)!.durationMs, transition.positionMs + report.capturedServerAt - transition.serverAt)));
    }
    observedDrifts.sort((a, b) => a - b);
    const synchronization = { targetMs: 300, observations: observedDrifts.length, maxAbsDriftMs: observedDrifts.length ? observedDrifts.at(-1)! : null, p95AbsDriftMs: observedDrifts.length ? observedDrifts[Math.min(observedDrifts.length - 1, Math.floor(observedDrifts.length * .95))] : null, note: run.config.mode === "individual" ? "Measured from device playback reports against the scheduled server timeline; not a physical screen/audio synchronisation measurement." : "Shared display media anchors are authoritative. Tablet timestamps are estimated and reconciled; inspect timing flags." };

    return { run, clip: clipFor(run), session: { id: session.id, name: session.name }, ...result,
      participants: participants.map(({ id, label, groupTag, excluded }) => ({ id, label, groupTag, excluded: Boolean(excluded) })),
      quality: { provisional: !uploadsReconciled(run), flagged: ratings.filter((row) => row.flags !== "[]").length, totalSamples: ratings.length, coverageGapBins: missing, unreconciledLabels: participants.filter((person) => !person.excluded && !participantReconciled(run, person.id)).map((person) => person.label), selectedParticipants: allowed.size, note: "No missing values are filled. Upload completion and coverage gaps are independent. Inspect raw flags before using results." }, ratings, reactions,
      transitions, playback, synchronization,
    };
  }
  api.get("/api/sessions/:sid/runs", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid));
    res.json(all<RunRow>("SELECT * FROM RecordingRun WHERE sessionId=? AND (?=1 OR practice=0) ORDER BY createdAt DESC", session.id, req.query.practice === "true" ? 1 : 0).map((run) => ({ ...run, config: JSON.parse(run.config), practice: Boolean(run.practice) })));
  });
  api.get("/api/runs/:rid/analysis", (req, res) => {
    const result = analyseRun(req, getRun(String(req.params.rid)));
    const { ratings: _ratings, reactions: _reactions, ...summary } = result; void _ratings; void _reactions;
    res.json(summary);
  });
  api.get("/api/runs/:rid/export/:kind", (req, res) => {
    const result = analyseRun(req, getRun(String(req.params.rid))), kind = String(req.params.kind);
    const metadata = { runId: result.run.id, practice: result.run.practice, question: result.run.config.question, options: result.options, rules: result.rules, quality: result.quality, exclusions: result.participants.filter((person) => person.excluded).map((person) => person.id), rawExportPolicy: "Raw exports contain all original rows, including flagged/excluded rows. Analysis filters apply to summary exports only." };
    let output = "";
    if (kind === "statistics") output = csv(["second", "mean", "sample_sd", "valid_n", "reactions"], result.bins.map((bin) => [bin.second, bin.mean, bin.sd, bin.n, bin.reactions]), metadata);
    else if (kind === "moments") output = csv(["kind", "second", "end_second", "value", "matched_n", "tied_occurrences"], result.moments.map((moment) => [moment.kind, moment.second, moment.endSecond, moment.value, moment.n, moment.ties]), metadata);
    else if (kind === "ratings" || kind === "reactions") {
      const rows = kind === "ratings" ? result.ratings : result.reactions;
      const headers = kind === "ratings" ? ["projectId", "sessionId", "clipId", "runId", "participantId", "sequence", "value", "videoMs", "reconciledVideoMs", "clientCapturedAt", "capturedServerAt", "receivedAt", "sessionMs", "playbackState", "timingSource", "uncertaintyMs", "flags"] : ["projectId", "sessionId", "clipId", "id", "runId", "participantId", "videoMs", "reconciledVideoMs", "clientCapturedAt", "capturedServerAt", "receivedAt", "sessionMs", "playbackState", "timingSource", "uncertaintyMs", "flags"];
      output = csv([...headers, "participantLabel", "groupTag", "runExcluded"], rows.map((row) => { const person = result.participants.find((person) => person.id === row.participantId); return [...headers.map((key) => (row as Record<string, unknown>)[key]), person?.label, person?.groupTag, person?.excluded]; }), metadata);
    } else throw new HttpError(404, "Unknown export");
    res.attachment(`dialit-${result.run.id}-${kind}.csv`).type("text/csv").send(output);
  });
  api.get("/api/sessions/:sid/archive", (req, res) => {
    const session = moderatorSession(req, String(req.params.sid));
    const runs = all<RunRow>("SELECT * FROM RecordingRun WHERE sessionId=?", session.id);
    const runIds = new Set(runs.map((run) => run.id));
    const archive = { format: "dialit-session-v1", exportedAt: now(), mediaIncluded: false, credentialPolicy: "Credential hashes are omitted. Issue new scoped recovery links to restored identities. Use full backup for exact credential restoration.", analysisOptions: analysisOptionsFromQuery(req.query),
      project: get("SELECT id,name,createdAt FROM Project WHERE id=?", session.projectId),
      session: { ...session, displayTokenHash: null }, clips: all("SELECT * FROM Clip WHERE projectId=?", session.projectId),
      participants: all<Participant>("SELECT * FROM Participant WHERE sessionId=?", session.id).map(({ tokenHash: _hash, ...person }) => { void _hash; return person; }), runs,
      uploadReceipts: all<{ runId: string }>("SELECT * FROM RunUpload").filter((row) => runIds.has(row.runId)),
      runParticipants: all<{ runId: string }>("SELECT * FROM RunParticipant").filter((row) => runIds.has(row.runId)),
      transitions: all<{ runId: string }>("SELECT * FROM RunTransition").filter((row) => runIds.has(row.runId)),
      ratings: all<{ runId: string }>("SELECT * FROM Rating").filter((row) => runIds.has(row.runId)),
      reactions: all<{ runId: string }>("SELECT * FROM Reaction").filter((row) => runIds.has(row.runId)),
      playback: all<{ runId: string }>("SELECT * FROM PlaybackEvent").filter((row) => runIds.has(row.runId)),
      diagnostics: all("SELECT * FROM Diagnostic WHERE sessionId=?", session.id),
    };
    res.attachment(`dialit-${session.id}-archive.json`).json(archive);
  });

  function handlePlayback(identity: Identity, raw: unknown) {
    const report = telemetrySchema.parse(raw), session = sessionFor(identity.sessionId), run = runFor(session);
    requireThat(run && run.id === report.runId, "Stale recording run", 409);
    requireThat(run.version === report.version, "Stale playback report", 409);
    const status = device(identity), at = now();
    const capturedAt = Math.abs(report.capturedServerAt - at) < 60000 ? report.capturedServerAt : at;
    const before = timeline(run, capturedAt);
    const advanced = Math.abs(status.positionMs - report.positionMs) > 80;
    if (run.state !== "recording" || advanced) status.lastAdvanceAt = at;
    if (report.kind === "ended") status.ended = true;
    else if (["ready", "playing"].includes(report.kind)) status.ended = false;
    const recordingBegan = get<{ serverAt: number }>("SELECT serverAt FROM RunTransition WHERE runId=? AND version=?", run.id, run.version)?.serverAt ?? run.anchorAt;
    const mediaDevice = identity.role === "display" || run.config.mode === "individual";
    const bufferRequired = Math.min(1, Math.max(0, (clipFor(run)!.durationMs - report.positionMs) / 1000));
    status.ready = report.ready && report.visible && report.latencyMs <= 300 && (!mediaDevice || report.buffered >= bufferRequired);
    status.visible = report.visible; status.positionMs = report.positionMs; status.pending = report.pending;
    status.latencyMs = report.latencyMs; if (report.error || report.kind === "ready") status.error = report.error; status.buffered = report.buffered; status.lastContact = at; status.lastPlaybackAt = at;
    status.driftMs = mediaDevice ? report.positionMs - before : 0;
    if (identity.participantId) put("UPDATE Participant SET telemetry=? WHERE id=?", JSON.stringify(publicTelemetry(status)), identity.participantId);
    put("INSERT INTO PlaybackEvent VALUES (?,?,?,?,?,?,?,?,?)", randomUUID(), run.id, identity.participantId ?? null, identity.role, report.kind, report.positionMs, at, capturedAt, JSON.stringify({ ...report, observedDriftMs: status.driftMs }));
    const excluded = identity.participantId && get<{ excluded: number }>("SELECT excluded FROM RunParticipant WHERE runId=? AND participantId=?", run.id, identity.participantId)?.excluded;
    if (run.state === "recording" && !excluded && identity.role !== "moderator") {
      if ((mediaDevice && report.kind === "tick" && at > recordingBegan + 2000 && at - (status.lastAdvanceAt ?? at) > 2000) || ["stalled", "waiting", "error", "seeking"].includes(report.kind) || !report.visible || (report.kind === "pause" && at > run.anchorAt + 700)) {
        safePause(session.id, `${identity.role} ${report.kind}${report.error ? `: ${report.error}` : ""}`); status.ready = false;
      } else if (identity.role === "display" && run.config.mode === "shared") {
        put("UPDATE RecordingRun SET positionMs=?,anchorAt=? WHERE id=?", Math.min(report.positionMs, clipFor(run)!.durationMs), capturedAt, run.id);
      } else if (run.config.mode === "individual" && at > run.anchorAt + 1500 && Math.abs(status.driftMs) > 300) {
        safePause(session.id, `${get<Participant>("SELECT * FROM Participant WHERE id=?", identity.participantId)?.label ?? "Tablet"} drift exceeded 300 ms`); status.ready = false;
      }
      if (report.kind === "ended" && (identity.role === "display" || (run.config.mode === "individual" && required(session, run).every((person) => live.get(person.id)?.ended)))) {
        const latest = getRun(run.id);
        if (latest.state === "recording") transition(latest, "completed", "Media playback completed");
      }
    }
    if (report.kind === "visibility" || report.kind === "error" || report.kind === "correction") diagnostic(session.id, run.id, report.kind, report, identity.participantId);
    updateReady(session.id); broadcast(session.id);
  }
  function ingest(identity: Identity, raw: unknown) {
    requireThat(identity.role === "participant", "Only participants may submit ratings", 403);
    const body = z.object({ ratings: z.array(sampleSchema).max(120), reactions: z.array(reactionSchema).max(120) }).parse(raw);
    const session = sessionFor(identity.sessionId), at = now();
    const validate = (sample: Sample | z.infer<typeof reactionSchema>) => {
      const run = getRun(sample.runId);
      requireThat(run.sessionId === session.id && get("SELECT 1 FROM RunParticipant WHERE runId=? AND participantId=?", run.id, identity.participantId), "Not enrolled in this recording run", 403);
      requireThat(sample.videoMs <= clipFor(run)!.durationMs + 1000 && sample.capturedServerAt <= at + 2000 && sample.capturedServerAt >= run.createdAt - 1000, "Invalid sample timing");
      const flags = new Set(sample.flags);
      const stateAtCapture = get<{ state: string; serverAt: number }>("SELECT state,serverAt FROM RunTransition WHERE runId=? AND serverAt<=? ORDER BY version DESC LIMIT 1", run.id, sample.capturedServerAt);
      if (stateAtCapture?.state !== "recording" || sample.playbackState !== "recording") flags.add("outside-recording");
      if (get<{ excluded: number }>("SELECT excluded FROM RunParticipant WHERE runId=? AND participantId=?", run.id, identity.participantId)?.excluded) flags.add("participant-excluded");
      if (sample.uncertaintyMs > 300) flags.add("timing-uncertain");
      let positionMs = sample.videoMs;
      if (run.config.mode === "shared") {
        if (sample.timingSource !== "display-anchor") flags.add("wrong-timing-source");
        const anchor = get<{ positionMs: number; capturedServerAt: number }>("SELECT positionMs,capturedServerAt FROM PlaybackEvent WHERE runId=? AND role='display' AND kind IN ('tick','playing') AND capturedServerAt<=? ORDER BY capturedServerAt DESC LIMIT 1", run.id, sample.capturedServerAt);
        if (!anchor || sample.capturedServerAt - anchor.capturedServerAt > 3000 || !stateAtCapture || anchor.capturedServerAt < stateAtCapture.serverAt) flags.add("unreconciled-anchor");
        else {
          const reconciled = anchor.positionMs + sample.capturedServerAt - anchor.capturedServerAt;
          if (Math.abs(reconciled - positionMs) > Math.max(300, sample.uncertaintyMs)) flags.add("anchor-disagreement");
          // Keep raw videoMs immutable; reconciliation and quality are recorded, never silently rewritten.
          positionMs = reconciled;
        }
      } else if (sample.timingSource !== "local-video") flags.add("wrong-timing-source");
      if (positionMs < 0 || positionMs > clipFor(run)!.durationMs) flags.add("outside-media");
      return { run, flags: JSON.stringify([...flags].sort()), reconciledVideoMs: run.config.mode === "shared" && !flags.has("unreconciled-anchor") ? positionMs : null };
    };
    const acknowledgedRatings: { runId: string; sequence: number }[] = [], acknowledgedReactions: string[] = [];
    db.transaction(() => {
      for (const sample of body.ratings) {
        const { run, flags, reconciledVideoMs } = validate(sample);
        put("INSERT OR IGNORE INTO Rating VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", run.id, identity.participantId, sample.sequence, session.projectId, session.id, run.clipId, sample.value, sample.videoMs, sample.clientCapturedAt, sample.capturedServerAt, at, sample.sessionMs, sample.playbackState, sample.timingSource, sample.uncertaintyMs, flags, reconciledVideoMs);
        acknowledgedRatings.push({ runId: run.id, sequence: sample.sequence });
      }
      for (const reaction of body.reactions) {
        const { run, flags, reconciledVideoMs } = validate(reaction);
        requireThat(run.config.reaction, "Reaction button is disabled for this run");
        const prior = get<{ participantId: string; runId: string }>("SELECT participantId,runId FROM Reaction WHERE id=?", reaction.id);
        requireThat(!prior || (prior.participantId === identity.participantId && prior.runId === run.id), "Reaction ID belongs to another identity", 403);
        put("INSERT OR IGNORE INTO Reaction VALUES (?,?,?,?,?,?,?,?,?,?)", reaction.id, run.id, identity.participantId, reaction.videoMs, reaction.clientCapturedAt, reaction.capturedServerAt, at, flags, JSON.stringify({ ...reaction, projectId: session.projectId, sessionId: session.id, clipId: run.clipId }), reconciledVideoMs);
        acknowledgedReactions.push(reaction.id);
      }
    })();
    return { ratings: acknowledgedRatings, reactions: acknowledgedReactions };
  }
  io.use((socket, next) => {
    try {
      const auth = z.object({ sessionId: idSchema, role: z.enum(["moderator", "participant", "display"]), token: z.string().max(100).default("") }).parse(socket.handshake.auth);
      socket.data.identity = authenticate(auth.sessionId, auth.role, auth.token, socket.request.headers.cookie);
      next();
    } catch (error) { next(new Error(error instanceof Error ? error.message : "Access denied")); }
  });
  io.on("connection", (socket: Socket) => {
    const identity = socket.data.identity as Identity;
    // A credential has one active device connection, including after browser refresh.
    if (identity.role !== "moderator") for (const [id, existing] of identities) if (keyFor(existing) === keyFor(identity)) io.sockets.sockets.get(id)?.disconnect(true);
    identities.set(socket.id, identity);
    const status = device(identity); status.connected = true; status.lastContact = now(); status.sockets.add(socket.id);
    const handle = (fn: (payload: unknown) => unknown) => (payload: unknown, ack?: (result: unknown) => void) => {
      try {
        // Revalidate expiry/revocation on each privileged event.
        authenticate(identity.sessionId, identity.role, typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "", socket.request.headers.cookie);
        const result = fn(payload); if (typeof ack === "function") ack({ ok: true, data: result });
      } catch (error) { if (typeof ack === "function") ack({ ok: false, error: error instanceof Error ? error.message : "Request failed" }); }
    };
    socket.on("heartbeat", () => {
      try { if (identity.role === "moderator") authenticate(identity.sessionId, "moderator", "", socket.request.headers.cookie); status.lastContact = now(); }
      catch { socket.disconnect(true); }
    });
    socket.on("clock", (_payload, ack) => { status.lastContact = now(); if (typeof ack === "function") ack({ serverAt: now() }); });
    socket.on("playback", handle((payload) => { requireThat(identity.role !== "moderator", "Moderator cannot report media playback", 403); handlePlayback(identity, payload); return true; }));
    socket.on("samples", handle((payload) => ingest(identity, payload)));
    socket.on("capture:finalize", handle((payload) => {
      requireThat(identity.role === "participant", "Participant credential required", 403);
      const totals = z.object({ runId: idSchema, expectedRatings: z.number().int().min(0).max(1000000), expectedReactions: z.number().int().min(0).max(1000000) }).parse(payload);
      const run = getRun(totals.runId);
      requireThat(run.sessionId === identity.sessionId && get("SELECT 1 FROM RunParticipant WHERE runId=? AND participantId=?", run.id, identity.participantId), "Wrong participant/run", 403);
      requireThat(terminal.has(run.state), "Run still active", 409);
      const ratings = get<{ n: number; next: number }>("SELECT count(*) n,COALESCE(max(sequence)+1,0) next FROM Rating WHERE runId=? AND participantId=?", run.id, identity.participantId)!;
      const reactions = get<{ n: number }>("SELECT count(*) n FROM Reaction WHERE runId=? AND participantId=?", run.id, identity.participantId)!;
      requireThat(ratings.n === totals.expectedRatings && ratings.next === totals.expectedRatings && reactions.n === totals.expectedReactions, "Counts not reconciled; pending samples or sequence gaps remain", 409);
      put("INSERT INTO RunUpload VALUES (?,?,?,?,?) ON CONFLICT(runId,participantId) DO UPDATE SET expectedRatings=excluded.expectedRatings,expectedReactions=excluded.expectedReactions,finalizedAt=excluded.finalizedAt", run.id, identity.participantId, totals.expectedRatings, totals.expectedReactions, now());
      broadcast(identity.sessionId); return true;
    }));
    socket.on("control", handle((payload) => { requireThat(identity.role === "moderator", "Moderator access required", 403); return control(sessionFor(identity.sessionId), payload); }));
    socket.on("diagnostic", handle((payload) => {
      const data = z.object({ kind: z.enum(["visibility", "storage-error", "gap", "wake-lock", "playback-error"]), details: z.string().max(500) }).parse(payload);
      diagnostic(identity.sessionId, sessionFor(identity.sessionId).currentRunId, data.kind, data.details, identity.participantId);
      if (identity.role === "participant" && ["storage-error", "playback-error"].includes(data.kind)) { device(identity).error = data.details; device(identity).ready = false; safePause(identity.sessionId, `${data.kind}: ${data.details}`); }
      return true;
    }));
    socket.on("disconnect", () => {
      identities.delete(socket.id); status.sockets.delete(socket.id); status.connected = status.sockets.size > 0; status.ready = false;
      const session = sessionFor(identity.sessionId), run = runFor(session);
      const included = !identity.participantId || !run || !get<{ excluded: number }>("SELECT excluded FROM RunParticipant WHERE runId=? AND participantId=?", run.id, identity.participantId)?.excluded;
      if (!status.connected && included && (identity.role === "moderator" || identity.role === "display" || run?.config.mode === "individual")) safePause(identity.sessionId, `${identity.role} disconnected; explicit recovery required`);
      diagnostic(identity.sessionId, run?.id ?? null, "disconnect", { role: identity.role }, identity.participantId);
      updateReady(identity.sessionId); broadcast(identity.sessionId);
    });
    broadcast(identity.sessionId);
  });
  const watchdog = setInterval(() => {
    for (const raw of all<RunRow>("SELECT * FROM RecordingRun WHERE state='preparing' AND createdAt<?", now() - 60000)) {
      if (get("SELECT id FROM Diagnostic WHERE runId=? AND kind='readiness-timeout'", raw.id)) continue;
      const session = sessionFor(raw.sessionId), run = getRun(raw.id);
      for (const person of required(session, run)) if (!person.telemetry.ready) { const status = live.get(person.id) ?? emptyLive(); status.error = "Readiness timed out after 60s. Check video/network/storage, then tap Ready to retry."; live.set(person.id, status); }
      if (run.config.mode === "shared") { const key = `display:${session.id}`, status = live.get(key) ?? emptyLive(); if (!status.ready) { status.error = "Readiness timed out after 60s; tap Ready on the display to retry."; live.set(key, status); } }
      diagnostic(session.id, run.id, "readiness-timeout", "Explicit readiness retry required"); broadcast(session.id);
    }
    for (const raw of all<RunRow>("SELECT * FROM RecordingRun WHERE state='recording'")) {
      const run = getRun(raw.id), session = sessionFor(run.sessionId);
      if (now() < run.anchorAt + 3000) continue;
      const moderatorLive = live.get(`moderator:${session.id}`);
      if (!moderatorLive?.connected || now() - moderatorLive.lastContact > 5000) { safePause(session.id, "Moderator heartbeat lost"); continue; }
      if (run.config.mode === "shared") {
        const display = live.get(`display:${session.id}`);
        if (!display?.connected || now() - (display.lastPlaybackAt ?? 0) > 3000) safePause(session.id, "Shared display heartbeat lost");
      } else if (required(session, run).some((person) => !person.telemetry.connected || now() - (live.get(person.id)?.lastPlaybackAt ?? 0) > 3000)) safePause(session.id, "Tablet heartbeat lost");
    }
  }, 500);
  watchdog.unref();
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) { _next(error); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") }); return; }
    if (error instanceof multer.MulterError) { res.status(413).json({ error: error.message }); return; }
    const status = error instanceof HttpError ? error.status : Number(error.status) || 500;
    if (status === 500) console.error(error);
    if (status === 416 && error.headers?.["Content-Range"]) res.setHeader("Content-Range", error.headers["Content-Range"]);
    res.status(status).json({ error: status === 500 ? "Server operation failed" : error.message });
  };
  return { api, http, io, errors, now, snapshot, close: async () => {
    clearInterval(watchdog);
    for (const raw of all<RunRow>("SELECT * FROM RecordingRun WHERE state IN ('preparing','ready','recording','paused')")) transition(getRun(raw.id), "interrupted", "Server stopped; viewing interrupted");
    await new Promise<void>((resolve) => io.close(() => resolve()));
  } };
}
