"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, Title, SubTitle, type ChartData, type ChartOptions, type Plugin } from "chart.js";
import { Line } from "react-chartjs-2";
import { api } from "../lib/client";
import type { Bin, Moment } from "../lib/analysis";
import type { Run, Clip } from "../lib/protocol";
import { Shell } from "./Shell";
ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, Title, SubTitle);
type Result = { run: Run; clip: Clip; session: { name: string }; bins: Bin[]; moments: Moment[]; rules: string; participants: { id: string; label: string; groupTag: string; excluded: boolean }[]; synchronization: { observations: number; maxAbsDriftMs: number | null; p95AbsDriftMs: number | null; note: string }; quality: { provisional: boolean; flagged: number; totalSamples: number; coverageGapBins: number; unreconciledLabels: string[]; selectedParticipants: number; note: string }; transitions: { state: string; reason: string; serverAt: number; positionMs: number }[] };
const palette = ["#7367b8", "#cb7b37", "#297bb5", "#b45e91", "#718f36", "#b85d4a"];
export function Dashboard({ sessionId }: { sessionId: string }) {
  const [runs, setRuns] = useState<Run[]>([]), [runId, setRunId] = useState(""), [practice, setPractice] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [loadedQuery, setLoadedQuery] = useState("");
  const [opening, setOpening] = useState(0), [windowSize, setWindowSize] = useState(3), [minimum, setMinimum] = useState(2), [participants, setParticipants] = useState<string[]>([]), [groups, setGroups] = useState<string[]>([]), [traces, setTraces] = useState(false), [flagged, setFlagged] = useState(false), [playhead, setPlayhead] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null), chart = useRef<ChartJS<"line"> | null>(null), headRef = useRef(0);
  useEffect(() => { headRef.current = playhead; }, [playhead]);
  useEffect(() => { Promise.resolve().then(() => { if (new URLSearchParams(location.search).get("practice") === "1") setPractice(true); }); }, []);
  useEffect(() => {
    let cancelled = false;
    void api<Run[]>(`/api/sessions/${sessionId}/runs?practice=${practice}`).then((data) => {
      if (cancelled) return;
      setRuns(data); const preferred = new URLSearchParams(location.search).get("run");
      setRunId((current) => data.some((run) => run.id === current) ? current : data.find((run) => run.id === preferred)?.id ?? data[0]?.id ?? "");
    }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId, practice]);
  const query = useMemo(() => new URLSearchParams({ opening: String(opening), window: String(windowSize), minContributors: String(minimum), participants: participants.join(","), groups: groups.join(","), includeFlagged: String(flagged) }).toString(), [opening, windowSize, minimum, participants, groups, flagged]);
  const shouldPoll = Boolean(runId && (!result || result.run.id !== runId || result.quality.provisional));
  useEffect(() => {
    let cancelled = false;
    const load = () => { if (runId) void api<Result>(`/api/runs/${runId}/analysis?${query}`).then((data) => { if (!cancelled) { setResult(data); setLoadedQuery(query); setError(""); } }).catch((err) => { if (!cancelled) setError(err.message); }); };
    load(); const timer = shouldPoll ? setInterval(load, 2500) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [runId, query, shouldPoll]);
  const analysisCurrent = result?.run.id === runId && loadedQuery === query;
  useEffect(() => { chart.current?.draw(); }, [playhead]);
  const data = useMemo<ChartData<"line", { x: number; y: number | null }[]>>(() => {
    const bins = result?.bins ?? [];
    const datasets: ChartData<"line", { x: number; y: number | null }[]>["datasets"] = [
      { label: "−1 sample SD", data: bins.map((bin) => ({ x: bin.second, y: bin.sd === null ? null : Math.max(0, bin.mean! - bin.sd) })), borderColor: "transparent", pointRadius: 0, fill: false },
      { label: "+1 sample SD band", data: bins.map((bin) => ({ x: bin.second, y: bin.sd === null ? null : Math.min(100, bin.mean! + bin.sd) })), borderColor: "transparent", backgroundColor: "rgba(0,127,120,.16)", pointRadius: 0, fill: "-1" },
      { label: "Mean rating", data: bins.map((bin) => ({ x: bin.second, y: bin.mean })), borderColor: "#007f78", backgroundColor: "#007f78", borderWidth: 3, pointRadius: bins.length < 120 ? 2 : 0, spanGaps: false },
    ];
    if (traces) for (const [index, person] of (result?.participants ?? []).entries()) datasets.push({ label: person.label + (person.groupTag ? ` · ${person.groupTag}` : ""), data: bins.map((bin) => ({ x: bin.second, y: bin.values[person.id] ?? null })), borderColor: palette[index % palette.length], borderWidth: 1, pointRadius: 0, spanGaps: false });
    datasets.push({ label: "Reaction events", data: bins.map((bin) => ({ x: bin.second, y: bin.reactions || null })), borderColor: "#b7781d", backgroundColor: "#b7781d", yAxisID: "reactions", showLine: false, pointStyle: "triangle", pointRadius: 5 });
    return { datasets };
  }, [result, traces]);
  const seek = (second: number) => { if (video.current) video.current.currentTime = second; setPlayhead(second); };
  const options: ChartOptions<"line"> = {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: "nearest", intersect: false },
    scales: { x: { type: "linear", min: opening, max: result ? result.clip.durationMs / 1000 : 1, title: { display: true, text: "Video time (seconds)" } }, y: { min: 0, max: 100, title: { display: true, text: "Rating (0–100)" } }, reactions: { position: "right", min: 0, ticks: { precision: 0 }, grid: { drawOnChartArea: false }, title: { display: true, text: "Reaction count" } } },
    plugins: { title: { display: true, text: result?.run.config.question ?? "Rating" }, subtitle: { display: true, text: [`Run ${result?.run.id ?? ""}${result?.run.practice ? " · PRACTICE" : ""}`, `Filters: opening ${opening}s; shift ${windowSize}s; minimum N=${minimum}; groups ${groups.join("/") || "all"}; flagged ${flagged ? "included" : "excluded"}`, `Participants: ${participants.length ? result?.participants.filter((person) => participants.includes(person.id)).map((person) => person.label).join(", ") : "all eligible"}; run exclusions: ${result?.participants.filter((person) => person.excluded).map((person) => person.label).join(", ") || "none"}`, "1s bins; nearest centre per participant; N−1 sample SD; gaps not filled"], font: { size: 10 } }, legend: { labels: { filter: (item) => item.datasetIndex !== 0 } }, tooltip: { callbacks: { afterBody: (items) => { const index = items[0]?.dataIndex; const bin = index === undefined ? null : result?.bins[index]; return bin ? [`Valid participants: ${bin.n}`, `Sample SD: ${bin.sd?.toFixed(2) ?? "N<2 — omitted"}`, `Reactions: ${bin.reactions}`] : []; } } } },
    onClick: (event, _elements, currentChart) => { if (event.x !== undefined && event.x !== null) seek(Math.max(0, currentChart.scales.x.getValueForPixel(event.x) ?? 0)); },
  };
  const overlays: Plugin<"line"> = {
    id: "dialit-overlays",
    beforeDraw(current) { const ctx = current.ctx; ctx.save(); ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, current.width, current.height); ctx.restore(); },
    afterDraw(current) {
      const { ctx, chartArea, scales } = current; if (!chartArea) return;
      ctx.save(); const x = scales.x.getPixelForValue(headRef.current);
      if (x >= chartArea.left && x <= chartArea.right) { ctx.strokeStyle = "#263545"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke(); ctx.setLineDash([]); }
      for (const moment of result?.moments ?? []) {
        const x = scales.x.getPixelForValue(moment.second);
        const mean = result?.bins.find((bin) => bin.second === moment.second)?.mean;
        if (mean === null || mean === undefined) continue;
        const y = scales.y.getPixelForValue(mean);
        ctx.fillStyle = moment.kind === "Peak" ? "#007f78" : moment.kind === "Trough" ? "#a44045" : "#a26d24";
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.font = "11px Arial"; ctx.fillText(moment.kind.replace("Largest ", ""), Math.min(x + 7, chartArea.right - 110), Math.max(chartArea.top + 12, y - 10));
      }
      ctx.restore();
    },
  };
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  return <Shell wide><div className="page-title"><div><p className="eyebrow">ACTUAL COLLECTED RATINGS</p><h1>{result?.session.name ?? "Session reporting"}</h1><p>Explore changes in the selected rating measure. Gaps remain gaps.</p></div><Link className="button secondary" href={`/moderator/${sessionId}`}>Moderator console</Link></div>
    {error && <p role="alert">{error} <Link href="/">Log in</Link></p>}
    <section><div className="toolbar"><label>Recording run<select value={runId} onChange={(event) => { setRunId(event.target.value); setParticipants([]); setGroups([]); }}><option value="">Choose run</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.practice ? "PRACTICE · " : ""}{new Date(run.createdAt).toLocaleString()} · {run.config.mode} · {run.state}</option>)}</select></label><label className="check"><input type="checkbox" checked={practice} onChange={(event) => setPractice(event.target.checked)} /> Show practice runs</label></div>{!runs.length && <p>No research recordings yet. Prepare and complete a viewing in the moderator console, or explicitly enable practice review.</p>}</section>
    {runId && !analysisCurrent && <p className="notice" role="status">Updating analysis. Any previous result below is provisional; exports are disabled until the active filters have loaded.</p>}
    {result && runId && <>
      {result.run.practice && <p className="notice">PRACTICE RUN — excluded from research reporting by default.</p>}
      <div className="status-strip"><b>{result.quality.provisional ? "PROVISIONAL · upload reconciliation incomplete" : "Known uploads reconciled"}</b><span>{result.quality.totalSamples} raw ratings · {result.quality.flagged} flagged · {result.quality.coverageGapBins} bins with incomplete selected-participant coverage</span></div>
      {result.quality.unreconciledLabels.length > 0 && <p className="muted">Final capture counts still required from: {result.quality.unreconciledLabels.join(", ")}. You may report provisional results with these limitations disclosed.</p>}
      <p className="muted">{result.synchronization.note} {result.synchronization.observations ? `${result.synchronization.observations} observed reports · maximum absolute drift ${result.synchronization.maxAbsDriftMs?.toFixed(0)}ms · 95th percentile ${result.synchronization.p95AbsDriftMs?.toFixed(0)}ms · target ±300ms.` : ""}</p>
      <section className="filters"><h2>Analysis filters</h2><div className="toolbar"><label>Exclude opening seconds<input type="number" min="0" max="7200" value={opening} onChange={(event) => setOpening(Math.max(0, Math.floor(Number(event.target.value))))} /></label><label>Shift window (seconds)<input type="number" min="1" max="600" value={windowSize} onChange={(event) => setWindowSize(Math.max(1, Math.floor(Number(event.target.value))))} /></label><label>Minimum shift contributors<input type="number" min="1" max="20" value={minimum} onChange={(event) => setMinimum(Math.max(1, Math.floor(Number(event.target.value))))} /></label><label className="check"><input type="checkbox" checked={traces} onChange={(event) => setTraces(event.target.checked)} /> Individual traces</label><label className="check"><input type="checkbox" checked={flagged} onChange={(event) => setFlagged(event.target.checked)} /> Include flagged timing (sensitivity analysis)</label></div>
      <details><summary>Participant and group filters (none selected = all eligible)</summary><div className="toolbar">{result.participants.map((person) => <label className="check" key={person.id}><input type="checkbox" checked={participants.includes(person.id)} disabled={person.excluded} onChange={() => setParticipants(toggle(participants, person.id))} />{person.label}{person.excluded ? " (excluded)" : ""}</label>)}</div><div className="toolbar">{[...new Set(result.participants.map((person) => person.groupTag))].filter(Boolean).map((group) => <label className="check" key={group}><input type="checkbox" checked={groups.includes(group)} onChange={() => setGroups(toggle(groups, group))} />{group}</label>)}</div></details></section>
      <div className="report-layout"><section><h2>Video review</h2><video key={result.clip.id} ref={video} src={`/api/clips/${result.clip.id}/media`} controls playsInline preload="metadata" onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)} /><p>{result.clip.title} · {result.run.config.question}</p></section><section><h2>Key moments</h2><div className="table-scroll"><table><thead><tr><th>Moment</th><th>Video time</th><th>Rating / shift</th><th>N / ties</th></tr></thead><tbody>{result.moments.map((moment) => <tr key={moment.kind}><td>{moment.kind}</td><td><button className="link-button" onClick={() => seek(moment.second)}>{moment.second}s{moment.endSecond !== undefined ? ` → ${moment.endSecond}s` : ""}</button></td><td>{moment.value.toFixed(2)}</td><td>{moment.n} / {moment.ties}</td></tr>)}</tbody></table></div>{!result.moments.length && <p>No valid statistics for these filters.</p>}<p className="muted">Shifts use participants present at both endpoints and continuous aggregate coverage. They can differ from the change in the overall mean when participant coverage changes. Ties show the earliest occurrence.</p></section></div>
      <section><div className="heading"><h2>Mean rating ±1 sample SD</h2><span>{playhead.toFixed(1)}s · {result.quality.selectedParticipants} selected participants</span></div><div className="chart"><Line role="img" aria-label="Rating chart: mean, sample standard deviation, participant traces and reaction counts" ref={chart} data={data} options={options} plugins={[overlays]} /></div><p className="muted">Click the chart to seek the video. Hover to see valid participant count and SD. The band is clipped visually to 0–100; underlying SD is unchanged.</p></section>
      <section><h2>Exports & archive</h2><div className="toolbar">{["ratings", "reactions", "statistics", "moments"].map((kind) => <a key={kind} className="button secondary" aria-disabled={!analysisCurrent} href={analysisCurrent ? `/api/runs/${runId}/export/${kind}?${query}` : undefined}>{kind} CSV</a>)}<button disabled={!analysisCurrent} onClick={() => { const image = chart.current?.toBase64Image("image/png", 1); if (image) { const link = document.createElement("a"); link.href = image; link.download = `dialit-${runId}-chart.png`; link.click(); } }}>Chart PNG</button><a className="button secondary" href={`/api/sessions/${sessionId}/archive?${query}`}>Full session archive</a></div><p>Raw CSV files retain all original rows and flags, including excluded rows. Summary CSV files and the chart use the active filters. The session JSON archive contains settings, all runs, raw data and events; <b>video media is not included</b>. Use the full backup procedure to preserve media and credentials.</p></section>
      <details className="panel"><summary>Analysis rules and interruption history</summary><p>{result.rules}</p><p>{result.quality.note}</p><ul>{result.transitions.map((entry, index) => <li key={index}>{entry.state} at {(entry.positionMs / 1000).toFixed(1)}s · {entry.reason}</li>)}</ul></details>
    </>}
  </Shell>;
}
