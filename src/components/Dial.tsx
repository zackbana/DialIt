"use client";
import { useEffect, useRef, useState } from "react";
import { useConnection, uuid } from "../lib/client";
import { acknowledge, readPending, saveRating, saveReaction, initialiseRun, captureTotals } from "../lib/queue";
import type { Sample } from "../lib/protocol";
import { Playback } from "./Playback";
import { Shell } from "./Shell";

export function Dial({ sessionId }: { sessionId: string }) {
  const c = useConnection(sessionId, "participant");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [rating, setRating] = useState(50), [pending, setPending] = useState(0), [storageError, setStorageError] = useState("");
  const [wakeMessage, setWakeMessage] = useState("Keep this page visible. If Wake Lock is unavailable, disable your tablet’s auto-lock manually.");
  const [readyLabel, setReadyLabel] = useState(false);
  const ratingRef = useRef(50), ready = useRef(false), pendingRef = useRef(0), storageFailed = useRef(false), flushing = useRef(false);
  const wake = useRef<WakeLockSentinel | null>(null), active = useRef(true);
  const run = c.state?.run;
  const individual = c.state?.config.mode === "individual";
  const storageFailure = (error: unknown) => {
    const message = `Ratings cannot be safely stored on this tablet: ${error instanceof Error ? error.message : "storage unavailable"}. Stop and ask the moderator for help.`;
    setStorageError(message); storageFailed.current = true; ready.current = false; c.diagnostic("storage-error", message);
  };
  async function requestWakeLock() {
    if (wake.current && !wake.current.released) return;
    if (!("wakeLock" in navigator)) { setWakeMessage("Wake Lock is unavailable (often on LAN HTTP). Disable auto-lock manually and keep this page visible."); return; }
    try {
      wake.current = await navigator.wakeLock.request("screen"); setWakeMessage("Screen Wake Lock is active. Keep this page visible.");
      wake.current.addEventListener("release", () => setWakeMessage("Screen Wake Lock released. Keep the page visible and check auto-lock settings."));
    } catch { setWakeMessage("Screen Wake Lock was denied. Disable auto-lock manually and keep this page visible."); }
  }
  function sampleBase(): Omit<Sample, "sequence" | "value"> | null {
    const snapshot = c.stateRef.current, current = snapshot?.run;
    if (storageFailed.current || !current || current.state !== "recording" || snapshot?.participant?.excluded || document.hidden || c.serverNow() < current.anchorAt) return null;
    const actual = snapshot.config.mode === "individual";
    if (actual && (!c.connected || !c.socket.current?.connected || videoRef.current?.paused)) return null;
    const elapsedAnchor = Math.max(0, c.serverNow() - snapshot.serverAt);
    const uncertaintyMs = c.clock.current.synced ? Math.max(5, c.clock.current.rtt / 2) + (actual ? 20 : elapsedAnchor * .03) : 60000;
    return { runId: current.id, videoMs: actual ? (videoRef.current?.currentTime ?? 0) * 1000 : c.estimatePosition(),
      clientCapturedAt: Date.now(), capturedServerAt: c.serverNow(), sessionMs: c.serverNow() - current.createdAt,
      playbackState: current.state, timingSource: actual ? "local-video" : "display-anchor", uncertaintyMs,
      flags: [...(!c.clock.current.synced ? ["clock-unsynced"] : []), ...(actual && videoRef.current?.paused ? ["local-video-paused"] : [])] };
  }
  async function refreshPending() {
    const owner = c.identity.current?.participantId; if (!owner) return;
    const records = await readPending(owner);
    pendingRef.current = records.count; if (active.current) setPending(records.count);
    return records;
  }
  async function flush() {
    if (flushing.current) return;
    const owner = c.identity.current?.participantId; if (!owner) return;
    flushing.current = true;
    try {
      const records = await refreshPending();
      if (!records || !c.socket.current?.connected) return;
      if (records.count) {
        let result: { ok: boolean; error?: string; data: Parameters<typeof acknowledge>[1] };
        try { result = await c.socket.current.timeout(7000).emitWithAck("samples", { ratings: records.ratings, reactions: records.reactions }); }
        catch { c.setError("Upload connection timed out. Persisted records will be retried automatically."); return; }
        if (!result.ok) { if (active.current) c.setError(`Upload not acknowledged: ${result.error}. Stored records remain on this device.`); return; }
        await acknowledge(owner, result.data); c.setError("");
      }
      const after = await refreshPending();
      if (after?.count === 0) for (const totals of await captureTotals(owner)) {
        const current = c.stateRef.current?.run;
        if (current?.id === totals.runId && !["completed", "interrupted"].includes(current.state)) continue;
        try { await c.socket.current.timeout(5000).emitWithAck("capture:finalize", totals); } catch { /* retry on next flush */ }
      }
    } catch (error) { storageFailure(error); }
    finally { flushing.current = false; }
  }
  useEffect(() => {
    active.current = true;
    let previous = performance.now();
    const capture = setInterval(() => {
      const elapsed = performance.now() - previous; previous = performance.now();
      if (elapsed > 1800) c.diagnostic("gap", `Timer gap ${Math.round(elapsed)}ms; no samples were fabricated`);
      const sample = sampleBase(), owner = c.identity.current?.participantId;
      if (sample && owner) void saveRating(owner, { ...sample, value: ratingRef.current }).then(refreshPending).catch(storageFailure);
    }, 1000);
    const uploads = setInterval(() => { void flush(); }, 1500);
    const heartbeat = setInterval(() => {
      if (c.stateRef.current?.config.mode !== "shared") return;
      c.report({ kind: "tick", positionMs: c.estimatePosition(), ready: ready.current, visible: !document.hidden, pending: pendingRef.current, error: "", buffered: 0 });
    }, 1000);
    const visibility = () => {
      c.diagnostic("visibility", document.visibilityState);
      if (document.hidden) ready.current = false;
      else if (c.stateRef.current?.run?.state === "recording") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { active.current = false; clearInterval(capture); clearInterval(uploads); clearInterval(heartbeat); document.removeEventListener("visibilitychange", visibility); };
    // Timers read the current server state, rating, and device identity through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.connected]);
  useEffect(() => {
    if (run?.state === "preparing" || run?.state === "paused") ready.current = false;
    const owner = c.identity.current?.participantId;
    if (owner && run && !["completed", "interrupted"].includes(run.state)) void initialiseRun(owner, run.id).catch(storageFailure);
    // Only a new run/state needs its durable zero-sample counter initialised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.state]);
  useEffect(() => () => { void wake.current?.release(); }, []);
  useEffect(() => {
    if (run?.state === "recording" && !document.hidden) void Promise.resolve().then(requestWakeLock);
    if (run && ["completed", "interrupted"].includes(run.state)) void wake.current?.release();
    // Screen lock follows run state and visibility, independent of network reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.state]);
  useEffect(() => {
    if (!run) return;
    void Promise.resolve().then(() => {
      try {
        const stored = localStorage.getItem(`dialit:rating:${sessionId}:${run.id}`);
        const value = stored === null ? 50 : Number(stored);
        if (Number.isFinite(value) && value >= 0 && value <= 100) { ratingRef.current = value; setRating(value); }
      } catch (error) { storageFailure(error); }
    });
    // Restore the slider only on a new viewing or page refresh, never on a pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, sessionId]);
  async function checkStorage() {
    try {
      const owner = c.identity.current?.participantId;
      if (!owner) throw new Error("Participant identity is unavailable");
      await readPending(owner); setStorageError(""); storageFailed.current = false;
    } catch (error) { storageFailure(error); throw error; }
    if (!c.clock.current.synced || c.clock.current.rtt / 2 > 300) throw new Error("Clock synchronisation is not ready or latency exceeds 300ms. Wait, then tap Ready again.");
    await requestWakeLock();
  }
  async function sharedReady() {
    try {
      const owner = c.identity.current?.participantId;
      if (!owner) throw new Error("Participant identity is unavailable");
      await checkStorage(); ready.current = true; setReadyLabel(true);
      c.report({ kind: "ready", positionMs: c.estimatePosition(), ready: true, visible: !document.hidden, pending, error: "", buffered: 0 });
    } catch (error) { c.setError(error instanceof Error ? error.message : "Readiness failed; retry"); }
  }
  const recording = run?.state === "recording" && !c.state?.participant?.excluded && (!individual || c.connected);
  return <Shell wide><div className="page-title"><div><p className="eyebrow">PARTICIPANT · {c.state?.participant?.label ?? "JOINING"}</p><h1>{c.state?.name ?? "Dial session"}</h1></div><span className={`badge ${c.connected ? "good" : "warn"}`}>{c.connected ? "Connected" : "Offline"}</span></div>
    <div className="status-strip" role="status"><b>{run?.practice ? "PRACTICE · " : ""}{run?.state.toUpperCase() ?? "WAITING"}</b><span>{pending ? `${pending} records pending upload · keep this tab open` : run && ["completed", "interrupted"].includes(run.state) ? (c.state?.participant?.uploadsReconciled ? "Final capture counts reconciled" : "Records uploaded · waiting for final count reconciliation") : "All locally queued records acknowledged"}</span></div>
    {c.error && <p role="alert">{c.error} <a href="/join">Join by code</a></p>}
    {storageError && <p role="alert">{storageError}</p>}
    {c.state?.participant?.excluded && <p role="alert">The moderator excluded you from this viewing. No further ratings will be collected for it.</p>}
    <div className={individual ? "individual-layout" : "dial-layout"}>
      {individual && <Playback key={run?.id ?? "waiting"} connection={c} videoRef={videoRef} pending={pending} beforeReady={checkStorage} />}
      <section className="dial-panel">
        <p className="eyebrow">{recording ? "RATE YOUR REACTION CONTINUOUSLY" : "WAIT FOR THE MODERATOR"}</p>
        <h2>{c.state?.config.question ?? "Waiting for the next viewing"}</h2>
        <output className="score" htmlFor="dial">{rating}</output>
        <label className="sr-only" htmlFor="dial">Current reaction rating, 0 to 100</label>
        <input className="dial-slider" id="dial" type="range" min="0" max="100" step="1" value={rating} disabled={!recording || Boolean(storageError)} onChange={(event) => { const value = Number(event.target.value); ratingRef.current = value; setRating(value); try { if (run) localStorage.setItem(`dialit:rating:${sessionId}:${run.id}`, String(value)); } catch (error) { storageFailure(error); } }} />
        <div className="endpoints"><span>0 · {c.state?.config.lowLabel}</span><span>{c.state?.config.highLabel} · 100</span></div>
        {c.state?.config.reaction && <button className="reaction" disabled={!recording || Boolean(storageError)} onClick={() => {
          const sample = sampleBase(), owner = c.identity.current?.participantId;
          if (sample && owner) void saveReaction(owner, { ...sample, id: uuid() }).then(refreshPending).catch(storageFailure);
        }}>Mark a reaction</button>}
        {!individual && run && ["preparing", "ready", "paused"].includes(run.state) && <button onClick={() => void sharedReady()}>{readyLabel ? "Ready · tap to recheck" : "Tap to Ready"}</button>}
        <p className="muted">Your rating is sampled once each second while recording, even if you leave the slider untouched. It is locked while paused.</p>
      </section>
    </div>
    <p className="device-note">{wakeMessage} {individual && <button className="secondary" onClick={() => void requestWakeLock()}>Keep screen awake</button>}</p>
    {run && ["completed", "interrupted"].includes(run.state) && <section><h2>{run.state === "interrupted" ? "Viewing interrupted" : "Viewing finished"}</h2><p>Keep this page open until pending uploads reach zero. Wait here for the next viewing.</p><button onClick={() => void flush()}>Retry pending uploads</button></section>}
  </Shell>;
}
