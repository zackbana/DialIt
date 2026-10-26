"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../components/Shell";
import { api } from "../lib/client";
type Project = { id: string; name: string };
type Session = { id: string; name: string; projectId: string; code: string };
export default function Home() {
  const [user, setUser] = useState(""), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]), [sessions, setSessions] = useState<Session[]>([]), [selected, setSelected] = useState("");
  async function load() {
    const data = await api<{ projects: Project[]; sessions: Session[] }>("/api/projects");
    setProjects(data.projects); setSessions(data.sessions); setSelected((current) => current || data.projects[0]?.id || "");
  }
  useEffect(() => { void api<{ username: string }>("/api/auth/me").then(async (data) => { setUser(data.username); await load(); }).catch(() => {}).finally(() => setLoaded(true)); }, []);
  const act = (action: Promise<unknown>) => { setError(""); void action.then(load).catch((err) => setError(err.message)); };
  return <Shell wide><div className="page-title"><div><p className="eyebrow">BEACON CONSULTING</p><h1>Measure the moment.</h1><p>Run live video dial tests and explore the reactions your participants actually recorded.</p></div><span className="badge">Research pilot</span></div>
    {!loaded ? <p>Loading…</p> : !user ? <div className="two-column"><section className="auth-card"><h2>Moderator login</h2><form onSubmit={(event) => {
      event.preventDefault(); const values = new FormData(event.currentTarget); setError("");
      void api<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username: values.get("username"), password: values.get("password") }) }).then(async (data) => { setUser(data.username); await load(); }).catch((err) => setError(err.message));
    }}><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input type="password" name="password" autoComplete="current-password" required /></label><button>Log in</button></form><p className="muted">First run? Create your moderator account in the terminal using <code>npm run moderator:create -- --username admin</code>.</p></section><section><h2>Taking part in a discussion?</h2><p>Use the session code provided by your moderator. You do not need a moderator account.</p><Link className="button" href="/join">Join a session</Link><p className="muted">Recordings are separate from clearly labelled practice viewings. No synthetic responses are included.</p></section></div> : <>
      <div className="toolbar"><span>Logged in as <b>{user}</b></span><button className="secondary" onClick={() => { void api("/api/auth/logout", { method: "POST" }).then(() => setUser("")).catch((err) => setError(err.message)); }}>Log out</button></div>
      <div className="two-column"><section><h2>Create a project</h2><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const name = new FormData(form).get("name"); act(api("/api/projects", { method: "POST", body: JSON.stringify({ name }) })); form.reset(); }}><label>Project name<input name="name" required maxLength={120} placeholder="Campaign evaluation" /></label><button>Create project</button></form></section>
      <section><h2>Create a session</h2><form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); act(api("/api/sessions", { method: "POST", body: JSON.stringify({ name: values.get("name"), projectId: selected }) })); event.currentTarget.reset(); }}><label>Project<select aria-label="Project" value={selected} onChange={(event) => setSelected(event.target.value)} required><option value="">Choose project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Session name<input name="name" required maxLength={120} placeholder="Group 1 · Morning" /></label><button disabled={!selected}>Create session</button></form></section></div>
      <h2 className="section-title">Projects & sessions</h2>{projects.length === 0 && <p>Create your first project to begin.</p>}{projects.map((project) => <section key={project.id}><h2>{project.name}</h2><div className="session-grid">{sessions.filter((session) => session.projectId === project.id).map((session) => <article className="session-card" key={session.id}><h3>{session.name}</h3><p>Join code <b>{session.code}</b></p><div className="toolbar"><Link className="button" href={`/moderator/${session.id}`}>Moderate</Link><Link href={`/dashboard/${session.id}`}>Report</Link></div></article>)}</div></section>)}
    </>}{error && <p role="alert">{error}</p>}
  </Shell>;
}
