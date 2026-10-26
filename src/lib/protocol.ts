import { z } from "zod";

export const configSchema = z.object({
  mode: z.enum(["shared", "individual"]).default("shared"),
  question: z.string().trim().min(1).max(200).default("How positive is your reaction right now?"),
  lowLabel: z.string().trim().min(1).max(60).default("Very negative"),
  highLabel: z.string().trim().min(1).max(60).default("Very positive"),
  reaction: z.boolean().default(false),
  groups: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type SessionConfig = z.infer<typeof configSchema>;
export type RunState = "waiting" | "preparing" | "ready" | "recording" | "paused" | "completed" | "interrupted";
export type Role = "moderator" | "participant" | "display";
export interface Run {
  id: string; sessionId: string; clipId: string; config: SessionConfig; practice: boolean;
  state: RunState; version: number; positionMs: number; anchorAt: number; createdAt: number; endedAt: number | null;
}
export interface Clip { id: string; title: string; durationMs: number; bytes: number }
export interface Telemetry {
  ready: boolean; visible: boolean; positionMs: number; pending: number; latencyMs: number;
  driftMs: number; error: string; buffered: number; lastContact: number; connected: boolean;
}
export interface ParticipantStatus {
  id: string; label: string; groupTag: string; excluded: boolean; telemetry: Partial<Telemetry>;
}
export interface Snapshot {
  id: string; name: string; code?: string; locked: boolean; config: SessionConfig;
  run: Run | null; clip: Clip | null; serverAt: number; timelineMs: number;
  participant?: { id: string; label: string; groupTag: string; excluded: boolean; uploadsReconciled: boolean };
  lastTransition?: { reason: string; serverAt: number };
  participants?: ParticipantStatus[]; display?: Partial<Telemetry>;
  quality?: { samples: number; flagged: number; reactions: number; pending: number; provisional: boolean };
}
export const sampleSchema = z.object({
  runId: z.string().uuid(), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  value: z.number().finite().min(0).max(100), videoMs: z.number().finite().min(0),
  clientCapturedAt: z.number().finite(), capturedServerAt: z.number().finite(),
  sessionMs: z.number().finite(), playbackState: z.string().max(20),
  timingSource: z.enum(["display-anchor", "local-video"]), uncertaintyMs: z.number().finite().min(0).max(3600000),
  flags: z.array(z.string().max(60)).max(20),
});
export type Sample = z.infer<typeof sampleSchema>;
export const reactionSchema = sampleSchema.omit({ value: true, sequence: true }).extend({ id: z.string().uuid() });
export type ReactionSample = z.infer<typeof reactionSchema>;
export const telemetrySchema = z.object({
  runId: z.string().uuid(), version: z.number().int().nonnegative(),
  kind: z.enum(["ready", "tick", "playing", "pause", "waiting", "stalled", "seeking", "ended", "visibility", "error", "correction"]),
  positionMs: z.number().finite().min(0), capturedServerAt: z.number().finite(),
  ready: z.boolean(), visible: z.boolean(), pending: z.number().int().min(0).max(1000000),
  latencyMs: z.number().finite().min(0).max(60000), buffered: z.number().finite().min(0),
  error: z.string().max(300).default(""),
});
export type PlaybackReport = z.infer<typeof telemetrySchema>;
