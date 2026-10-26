"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
type Message = { id: string; text: string; createdAt: string };
export default function Home() {
  const socket = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const client = io();
    socket.current = client;
    const onMessage = (message: Message) => setMessages((items) =>
      [...items.filter((item) => item.id !== message.id), message].slice(-50));
    client.on("connect", () => {
      setConnected(true);
      void fetch("/api/messages").then((res) => {
        if (!res.ok) throw new Error("Unable to load history");
        return res.json() as Promise<Message[]>;
      }).then((history) => setMessages((items) => {
        const unique = new Map([...history, ...items].map((item) => [item.id, item]));
        return [...unique.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
      })).catch(() => setError("Unable to load message history"));
    });
    client.on("disconnect", () => setConnected(false));
    client.on("connect_error", () => setError("Connection failed. Retrying…"));
    client.on("message:created", onMessage);
    return () => { client.disconnect(); };
  }, []);
  return <main>
    <p className="eyebrow">DEVELOPMENT FOUNDATION</p>
    <h1>DialIt<span>.</span></h1>
    <p>Next.js, persistent connections, and a local database. Ready to build.</p>
    <section>
      <div className="heading"><h2>Realtime connection check</h2><span role="status">{connected ? "● Connected" : "○ Connecting"}</span></div>
      <p>Send a test message. It is saved to SQLite and appears in every connected tab.</p>
      <ul aria-live="polite">{messages.map((message) => <li key={message.id}>{message.text}</li>)}</ul>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!socket.current || pending) return;
        setPending(true);
        setError("");
        socket.current.timeout(5000).emit("message:create", text, (err: Error | null, result: { ok: boolean; error?: string }) => {
          setPending(false);
          if (err || !result?.ok) setError(result?.error ?? "Message timed out. Check history before retrying.");
          else setText("");
        });
      }}>
        <label htmlFor="message">Test message</label>
        <div className="input-row"><input id="message" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} required placeholder="Say hello to DialIt" /><button disabled={!connected || pending || !text.trim()}>{pending ? "Sending…" : "Send"}</button></div>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
    <footer>Local development demo · No authentication configured</footer>
  </main>;
}
