"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Role, Snapshot, PlaybackReport } from "./protocol";

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
export function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export interface Identity { sessionId: string; participantId: string; label: string; token: string }
export function useConnection(sessionId: string, role: Role) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const socket = useRef<Socket | null>(null), stateRef = useRef<Snapshot | null>(null);
  const credential = useRef(""), identity = useRef<Identity | null>(null);
  const lastServerContact = useRef(0), linkTimedOut = useRef(false);
  const clock = useRef({ offset: 0, rtt: Infinity, synced: false });
  const epoch = useRef({ wall: 0, mono: 0 });
  const localNow = () => epoch.current.wall + performance.now() - epoch.current.mono;
  const serverNow = () => localNow() + clock.current.offset;
  const estimatePosition = () => {
    const current = stateRef.current;
    if (!current?.run) return 0;
    const run = current.run;
    return Math.min(current.clip?.durationMs ?? Infinity, run.positionMs + (run.state === "recording" ? Math.max(0, serverNow() - run.anchorAt) : 0));
  };
  useEffect(() => {
    let client: Socket | null = null, cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    epoch.current = { wall: Date.now(), mono: performance.now() };
    const readings: { rtt: number; offset: number }[] = [];
    const ping = () => {
      if (!client?.connected) return;
      const start = localNow();
      client.timeout(3000).emit("clock", {}, (err: Error | null, result: { serverAt: number }) => {
        if (err || !result) return;
        lastServerContact.current = performance.now();
        if (linkTimedOut.current) { linkTimedOut.current = false; setConnected(true); setError(""); }
        const end = localNow(); readings.push({ rtt: end - start, offset: result.serverAt - (start + end) / 2 });
        if (readings.length > 20) readings.shift();
        const best = readings.reduce((a, b) => a.rtt < b.rtt ? a : b);
        clock.current = { ...best, synced: true };
      });
    };
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        if (role === "participant") {
          const incoming = new URLSearchParams(location.search).get("credential");
          const stored = localStorage.getItem(`dialit:identity:${sessionId}`);
          if (incoming) credential.current = incoming;
          else {
            if (!stored) { setError("Join this session using its six-digit code first."); return; }
            identity.current = JSON.parse(stored); credential.current = identity.current!.token;
          }
        } else if (role === "display") credential.current = new URLSearchParams(location.search).get("token") ?? "";
        client = io({ auth: { sessionId, role, token: credential.current }, reconnection: true });
        socket.current = client;
        client.on("connect", () => { lastServerContact.current = performance.now(); linkTimedOut.current = false; setConnected(true); setError(""); readings.length = 0; clock.current.synced = false; for (let i = 0; i < 5; i++) timers.push(setTimeout(ping, i * 180)); });
        client.on("state", (next: Snapshot) => {
          lastServerContact.current = performance.now();
          if (linkTimedOut.current) { linkTimedOut.current = false; setConnected(true); setError(""); }
          if (role === "participant" && next.participant) {
            identity.current = { sessionId, participantId: next.participant.id, label: next.participant.label, token: credential.current };
            try { localStorage.setItem(`dialit:identity:${sessionId}`, JSON.stringify(identity.current)); if (new URLSearchParams(location.search).has("credential")) history.replaceState(history.state, "", location.pathname); }
            catch { setError("Device identity could not be persisted. Do not refresh; ask the moderator for storage help."); }
          }
          stateRef.current = next; setState(next);
        });
        client.on("connect_error", (err: Error) => { setConnected(false); setError(err.message); });
        client.on("disconnect", (reason) => { setConnected(false); setError(reason === "io server disconnect" ? "This credential was replaced or disconnected. Reload to reconnect." : "Connection lost. Pending ratings stay on this device."); });
      } catch { setError("Browser storage is unavailable. Enable local storage before joining."); }
    });
    const visibility = () => {
      clock.current.synced = false; readings.length = 0;
      if (!document.hidden) for (let i = 0; i < 5; i++) timers.push(setTimeout(ping, i * 180));
    };
    document.addEventListener("visibilitychange", visibility);
    const interval = setInterval(() => {
      ping(); if (role === "moderator") client?.emit("heartbeat");
      if (client?.connected && performance.now() - lastServerContact.current > 3000 && !linkTimedOut.current) {
        linkTimedOut.current = true; setConnected(false); setError(role === "display" || stateRef.current?.config.mode === "individual" ? "No server heartbeat. Media playback is paused locally; queued records remain on this device." : "No server heartbeat. Pending records remain on this device; shared-mode timing is estimated until reconnection.");
      }
    }, 1000);
    return () => { cancelled = true; client?.disconnect(); timers.forEach(clearTimeout); clearInterval(interval); document.removeEventListener("visibilitychange", visibility); };
    // sessionId and role define the lifetime of a device connection; timing functions read stable refs.
  }, [sessionId, role]);
  const diagnostic = (kind: string, details: string) => socket.current?.emit("diagnostic", { kind, details });
  const report = (input: Omit<PlaybackReport, "runId" | "version" | "capturedServerAt" | "latencyMs">) => {
    const run = stateRef.current?.run;
    if (!run || !connected) return;
    socket.current?.emit("playback", { ...input, runId: run.id, version: run.version, capturedServerAt: serverNow(), latencyMs: Number.isFinite(clock.current.rtt) ? clock.current.rtt / 2 : 60000 });
  };
  const mediaUrl = (clipId: string) => `/api/clips/${clipId}/media?sessionId=${encodeURIComponent(sessionId)}&role=${role}&token=${encodeURIComponent(credential.current)}`;
  return { state, stateRef, socket, connected, error, setError, identity, clock, serverNow, estimatePosition, report, diagnostic, mediaUrl };
}
export type Connection = ReturnType<typeof useConnection>;
