import { z } from "zod";
export interface AnalysisRating { participantId: string; sequence: number; value: number; videoMs: number; flags: string }
export interface AnalysisReaction { participantId: string; videoMs: number; flags: string }
export interface AnalysisOptions { participants: string[]; groups: string[]; opening: number; window: number; minContributors: number; includeFlagged: boolean }
export const defaultAnalysis: AnalysisOptions = { participants: [], groups: [], opening: 0, window: 3, minContributors: 2, includeFlagged: false };
export function analysisOptionsFromQuery(query: unknown): AnalysisOptions {
  const input = z.object({
    participants: z.string().max(2000).default(""), groups: z.string().max(1000).default(""),
    opening: z.coerce.number().int().min(0).max(7200).default(0),
    window: z.coerce.number().int().min(1).max(600).default(3),
    minContributors: z.coerce.number().int().min(1).max(20).default(2),
    includeFlagged: z.enum(["true", "false"]).default("false"),
  }).parse(query);
  return { ...input, participants: z.array(z.string().uuid()).max(20).parse(input.participants.split(",").filter(Boolean)), groups: z.array(z.string().max(40)).max(20).parse(input.groups.split(",").filter(Boolean)), includeFlagged: input.includeFlagged === "true" };
}
export interface Bin { second: number; mean: number | null; sd: number | null; n: number; reactions: number; values: Record<string, number> }
export interface Moment { kind: string; second: number; endSecond?: number; value: number; n: number; ties: number }
export const analysisRules = "One rating per participant per 1s bin [s,s+1), nearest s+0.5; ties use lower sequence. No interpolation/carry-forward. SD uses N−1, omitted for N<2. Peak/trough ties use earliest bin and disclose occurrences. Shifts compare matched participants at both endpoints, require continuous aggregate coverage, and do not imply changes in any measure beyond the configured question. Flagged timing samples are excluded by default; raw exports retain them.";
export function analyse(ratings: AnalysisRating[], reactions: AnalysisReaction[], options: AnalysisOptions, allowed: Set<string>, durationMs: number) {
  const selected = new Map<number, Map<string, AnalysisRating>>();
  for (const rating of ratings) {
    if (!allowed.has(rating.participantId) || (!options.includeFlagged && JSON.parse(rating.flags).length)) continue;
    const second = Math.floor(rating.videoMs / 1000);
    if (second < options.opening || rating.videoMs > durationMs || second >= Math.ceil(durationMs / 1000)) continue;
    const byParticipant = selected.get(second) ?? new Map<string, AnalysisRating>();
    const prior = byParticipant.get(rating.participantId);
    const distance = Math.abs(rating.videoMs - (second * 1000 + 500));
    const priorDistance = prior ? Math.abs(prior.videoMs - (second * 1000 + 500)) : Infinity;
    if (!prior || distance < priorDistance || (distance === priorDistance && rating.sequence < prior.sequence)) byParticipant.set(rating.participantId, rating);
    selected.set(second, byParticipant);
  }
  const bins: Bin[] = [];
  for (let second = options.opening; second < Math.ceil(durationMs / 1000); second++) {
    const entries = [...(selected.get(second)?.values() ?? [])];
    const n = entries.length;
    const mean = n ? entries.reduce((sum, row) => sum + row.value, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(entries.reduce((sum, row) => sum + (row.value - mean!) ** 2, 0) / (n - 1)) : null;
    bins.push({ second, mean, sd, n, reactions: 0, values: Object.fromEntries(entries.map((row) => [row.participantId, row.value])) });
  }
  for (const reaction of reactions) {
    if (!allowed.has(reaction.participantId) || (!options.includeFlagged && JSON.parse(reaction.flags).length)) continue;
    const bin = bins[Math.floor(reaction.videoMs / 1000) - options.opening];
    if (bin) bin.reactions++;
  }
  const valid = bins.filter((bin) => bin.mean !== null);
  const moments: Moment[] = [];
  for (const kind of ["Peak", "Trough"]) {
    if (!valid.length) continue;
    const value = (kind === "Peak" ? Math.max : Math.min)(...valid.map((bin) => bin.mean!));
    const tied = valid.filter((bin) => bin.mean === value);
    moments.push({ kind, second: tied[0].second, value, n: tied[0].n, ties: tied.length });
  }
  const shifts: Moment[] = [];
  for (let i = 0; i + options.window < bins.length; i++) {
    const interval = bins.slice(i, i + options.window + 1);
    if (interval.some((bin) => bin.mean === null)) continue;
    const a = bins[i], b = bins[i + options.window];
    const matched = Object.keys(a.values).filter((id) => b.values[id] !== undefined);
    if (matched.length < options.minContributors) continue;
    shifts.push({ kind: "Shift", second: a.second, endSecond: b.second, value: matched.reduce((sum, id) => sum + b.values[id] - a.values[id], 0) / matched.length, n: matched.length, ties: 1 });
  }
  for (const direction of [1, -1]) {
    const eligible = shifts.filter((shift) => shift.value * direction > 0).sort((a, b) => direction * (b.value - a.value) || a.second - b.second);
    if (eligible[0]) moments.push({ ...eligible[0], kind: direction === 1 ? "Largest positive shift" : "Largest negative shift", ties: eligible.filter((shift) => shift.value === eligible[0].value).length });
  }
  return { bins, moments, options, rules: analysisRules };
}
export function csv(headers: string[], rows: unknown[][], metadata?: unknown) {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (metadata ? [["Analysis metadata", JSON.stringify(metadata)]] : []).concat([headers], rows as string[][]).map((row) => row.map(cell).join(",")).join("\r\n");
}
