"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
export function JoinCard({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null), [link, setLink] = useState("");
  useEffect(() => {
    const url = `${location.origin}/join?code=${code}`;
    Promise.resolve().then(() => setLink(url));
    if (canvas.current) void QRCode.toCanvas(canvas.current, url, { width: 176, margin: 1 });
  }, [code]);
  return <div className="join-card"><canvas ref={canvas} aria-label={`QR code for session ${code}`} /><div><p className="eyebrow">JOIN THIS SESSION</p><strong className="join-code">{code}</strong><p><a href={link}>{link}</a></p><p className="muted">Use the server’s Wi-Fi address, not localhost, when opening this page for tablet joining.</p></div></div>;
}
