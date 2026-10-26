"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Connection } from "../lib/client";

export function Playback({ connection: c, videoRef, pending = 0, beforeReady }: { connection: Connection; videoRef: RefObject<HTMLVideoElement | null>; pending?: number; beforeReady?: () => Promise<void> }) {
  const [armed, setArmed] = useState(false), [error, setError] = useState(""), [muted, setMuted] = useState(false);
  const ready = useRef(false), internalSeek = useRef(false), pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const run = c.state?.run, clip = c.state?.clip;
  const report = (kind: "ready" | "tick" | "playing" | "pause" | "waiting" | "stalled" | "seeking" | "ended" | "visibility" | "error" | "correction", message = "") => {
    const video = videoRef.current; if (!video) return;
    let buffered = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime + .1 && video.buffered.end(i) >= video.currentTime) buffered = video.buffered.end(i) - video.currentTime;
    c.report({ kind, positionMs: video.currentTime * 1000, ready: ready.current && video.readyState >= 3, visible: document.visibilityState === "visible", pending: pendingRef.current, buffered, error: message });
  };
  useEffect(() => {
    const video = videoRef.current; if (!video || !run) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (run.state !== "recording") {
      if (run.state === "preparing" || run.state === "paused") ready.current = false;
      video.pause();
      const target = run.positionMs / 1000;
      if (Math.abs(video.currentTime - target) > .15) {
        internalSeek.current = true; video.currentTime = target;
        report("correction");
      }
    } else {
      timer = setTimeout(() => {
        if (!ready.current || document.hidden) { report("error", "Tap to enable playback on this device"); return; }
        void video.play().then(() => { setError(""); report("playing"); }).catch(() => { ready.current = false; setArmed(false); setError("Tap to enable playback, then ask the moderator to resume."); report("error", "Browser rejected video.play()"); });
      }, Math.max(0, run.anchorAt - c.serverNow()));
    }
    return () => { if (timer) clearTimeout(timer); };
    // State versions identify commands; display anchor updates must never reschedule playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.version]);
  useEffect(() => {
    if (!c.connected) { ready.current = false; videoRef.current?.pause(); }
  }, [c.connected, videoRef]);
  useEffect(() => {
    const interval = setInterval(() => report("tick"), 500);
    const visibility = () => { if (document.hidden) { ready.current = false; videoRef.current?.pause(); } report("visibility"); };
    document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", visibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.connected]);
  async function enable() {
    const video = videoRef.current;
    if (!video || !run) return;
    try {
      if (beforeReady) await beforeReady();
      if (!c.clock.current.synced || c.clock.current.rtt / 2 > 300) throw new Error("Clock synchronisation is not ready or latency exceeds 300ms. Wait, then tap Ready again.");
      if (video.readyState < 3) throw new Error("Video is still buffering. Wait, then tap Ready again.");
      await video.play(); video.pause();
      const target = c.estimatePosition() / 1000;
      if (Math.abs(video.currentTime - target) > .005) {
        internalSeek.current = true;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { video.removeEventListener("seeked", done); reject(new Error("Video alignment timed out. Tap Ready to retry.")); }, 10000);
          const done = () => { clearTimeout(timer); video.removeEventListener("seeked", done); resolve(); };
          video.addEventListener("seeked", done); video.currentTime = target;
        });
      }
      if (c.stateRef.current?.run?.id !== run.id || c.stateRef.current.run.state === "recording") throw new Error("Viewing changed; check readiness again");
      if (video.readyState < 3) throw new Error("Video is buffering after alignment. Wait, then tap Ready again.");
      ready.current = true; setArmed(true); setError("");
      report("correction"); report("ready");
    } catch (err) {
      ready.current = false; setArmed(false); setError(err instanceof Error ? err.message : "Tap to enable playback");
      report("error", "Playback readiness failed; retry Tap to Ready");
    }
  }
  if (!clip) return <section><h2>Waiting for a clip</h2><p>The moderator will prepare the next viewing.</p></section>;
  return <div className="playback">
    <video ref={videoRef} src={c.mediaUrl(clip.id)} playsInline preload="auto" muted={muted}
      onPlaying={() => report("playing")} onPause={() => { if (!videoRef.current?.ended) report("pause"); }}
      onWaiting={() => report("waiting")} onStalled={() => report("stalled")}
      onSeeking={() => { if (!internalSeek.current) report("seeking"); }}
      onSeeked={() => { internalSeek.current = false; }}
      onEnded={() => report("ended")} onError={() => { ready.current = false; setError("Video could not be played. Ask the moderator to check the MP4 encoding."); report("error", "Media decoding or network error"); }}
      onRateChange={() => { const video = videoRef.current; if (video && video.playbackRate !== 1) { video.playbackRate = 1; report("error", "Playback rate changed"); } }} />
    <div className="toolbar">
      {run?.state !== "recording" && <button onClick={() => void enable()}>{armed ? "Ready · tap to recheck" : "Tap to Ready / enable playback"}</button>}
      <button className="secondary" onClick={() => setMuted(!muted)}>{muted ? "Unmute audio" : "Mute audio"}</button>
      <label className="compact">Volume<input aria-label="Video volume" type="range" min="0" max="1" step=".05" defaultValue="1" onChange={(event) => { if (videoRef.current) videoRef.current.volume = Number(event.target.value); }} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="muted">{clip.title} · Playback is controlled by the moderator. {run?.state === "paused" ? "Paused. Tap Ready again before resuming." : ""}</p>
  </div>;
}
