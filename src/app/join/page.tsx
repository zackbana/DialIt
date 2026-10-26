"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Identity } from "../../lib/client";
import { Shell } from "../../components/Shell";
export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState(""), [group, setGroup] = useState(""), [info, setInfo] = useState<{ id: string; name: string; groups: string[] } | null>(null), [error, setError] = useState("");
  useEffect(() => { Promise.resolve().then(() => { const value = new URLSearchParams(location.search).get("code"); if (value) setCode(value); }); }, []);
  useEffect(() => {
    let cancelled = false;
    if (/^\d{6}$/.test(code)) void api<{ id: string; name: string; groups: string[] }>(`/api/join/${code}`).then((data) => { if (!cancelled) { setInfo(data); setError(""); } }).catch((err) => { if (!cancelled) { setInfo(null); setError(err.message); } });
    return () => { cancelled = true; };
  }, [code]);
  return <Shell><section className="auth-card"><p className="eyebrow">WELCOME TO DIALIT</p><h1>Join your session</h1><p>Enter the code shown by your moderator. You will receive an anonymous participant ID.</p>
    <form onSubmit={(event) => { event.preventDefault();
      try {
        const stored = info && localStorage.getItem(`dialit:identity:${info.id}`);
        if (stored && info) { router.push(`/dial/${info.id}`); return; }
        localStorage.setItem("dialit:storage-probe", "1"); localStorage.removeItem("dialit:storage-probe");
      } catch { setError("Browser storage is blocked. Enable local storage before joining."); return; }
      void api<Identity>("/api/join", { method: "POST", body: JSON.stringify({ code, groupTag: group }) }).then((identity) => {
      try { localStorage.setItem(`dialit:identity:${identity.sessionId}`, JSON.stringify(identity)); router.push(`/dial/${identity.sessionId}`); } catch { setError("Browser storage is blocked. Enable local storage before joining."); }
    }).catch((err) => setError(err.message)); }}>
      <label>Session code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setGroup(""); }} /></label>
      {info && <p>{info.name}</p>}
      {info?.groups.length ? <label>Group (optional)<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">No group</option>{info.groups.map((tag) => <option key={tag}>{tag}</option>)}</select></label> : null}
      <button disabled={!info || code.length !== 6}>Join session</button>
    </form>{error && <p role="alert">{error}</p>}
    <p className="muted">Already joined? Reopen your original tablet tab or its bookmarked participant URL. Do not clear browser data while uploads are pending.</p>
  </section></Shell>;
}
