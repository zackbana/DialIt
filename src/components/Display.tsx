"use client";
import { useRef } from "react";
import { useConnection } from "../lib/client";
import { JoinCard } from "./JoinCard";
import { Playback } from "./Playback";
export function Display({ sessionId }: { sessionId: string }) {
  const c = useConnection(sessionId, "display"), video = useRef<HTMLVideoElement | null>(null);
  return <main className="display-screen"><p className="eyebrow">BEACON CONSULTING · SHARED DISPLAY</p><h1>{c.state?.name ?? "DialIt"}</h1>
    {c.error && <p role="alert">{c.error}</p>}
    {c.state?.config.mode === "individual" ? <section><h2>Individual Tablet Mode</h2><p>Participants watch the video on their own tablets.</p></section> : <Playback key={c.state?.run?.id ?? "waiting"} connection={c} videoRef={video} />}
    {c.state?.code && c.state?.run?.state !== "recording" && <section><JoinCard code={c.state.code} /></section>}
    <p role="status">{c.state?.run?.state === "recording" ? "Viewing in progress" : `${c.state?.run?.state ?? "Waiting"} · Follow the moderator’s instructions.`}</p>
  </main>;
}
