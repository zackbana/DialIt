import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, defaultAnalysis, csv, type AnalysisRating } from "../src/lib/analysis";
function rating(participantId: string, second: number, value: number, sequence = second, offset = 500, flags: string[] = []): AnalysisRating { return { participantId, sequence, value, videoMs: second * 1000 + offset, flags: JSON.stringify(flags) }; }
test("known-data means, N−1 SD, nearest-centre selection, tie rule, gaps and earliest tied peaks", () => {
  const rows = [rating("a", 0, 10, 1, 400), rating("a", 0, 90, 2, 600), rating("b", 0, 30), rating("a", 1, 70), rating("b", 1, 99, 1, 500, ["timing-uncertain"]), rating("a", 3, 70)];
  const result = analyse(rows, [{ participantId: "a", videoMs: 500, flags: "[]" }], defaultAnalysis, new Set(["a", "b"]), 4000);
  assert.equal(result.bins[0].mean, 20); assert.equal(result.bins[0].n, 2);
  assert.ok(Math.abs(result.bins[0].sd! - Math.sqrt(200)) < 1e-10);
  assert.equal(result.bins[1].sd, null); assert.equal(result.bins[1].n, 1);
  assert.equal(result.bins[2].mean, null); assert.equal(result.bins[2].n, 0);
  assert.equal(result.bins[0].reactions, 1);
  assert.deepEqual(result.moments.find((row) => row.kind === "Peak"), { kind: "Peak", second: 1, value: 70, n: 1, ties: 2 });
  assert.ok(!result.moments.some((row) => row.kind.includes("shift")));
});
test("shifts use matched contributors, continuous coverage, consistent filters and opening exclusions", () => {
  const rows = [rating("a", 0, 20), rating("b", 0, 40), rating("c", 0, 100), rating("a", 1, 30), rating("a", 2, 40), rating("a", 3, 50), rating("b", 3, 70)];
  const result = analyse(rows, [], defaultAnalysis, new Set(["a", "b", "c"]), 4000);
  const shift = result.moments.find((row) => row.kind === "Largest positive shift")!;
  assert.equal(shift.value, 30); assert.equal(shift.n, 2); assert.notEqual(shift.value, result.bins[3].mean! - result.bins[0].mean!);
  const filtered = analyse(rows, [], { ...defaultAnalysis, opening: 1 }, new Set(["a"]), 4000);
  assert.deepEqual(filtered.bins.map((bin) => bin.second), [1, 2, 3]);
  assert.equal(filtered.moments.find((row) => row.kind === "Trough")?.second, 1);
  assert.ok(!filtered.moments.some((row) => row.kind.includes("shift")));
});
test("CSV quotes fields and neutralises spreadsheet formulas while preserving numeric negative shifts", () => {
  const text = csv(["text", "number"], [["  =HYPERLINK(\"bad\")", -12], ["@sum", 4], ["line\nbreak", 0]]);
  assert.match(text, /'  =HYPERLINK/); assert.match(text, /"-12"/); assert.match(text, /'@sum/); assert.match(text, /line\nbreak/);
});
