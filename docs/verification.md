# Verification evidence — 26 October 2026

This is an implementation/verification record for the pilot, not a production-readiness certification. Tests used temporary isolated databases and explicitly labelled synthetic fixtures. No test responses were inserted into the normal research database.

## Executed automated checks

| Check | Result | What actually ran |
| --- | --- | --- |
| `npm ci`, `npm run setup` repeated | Passed | Frozen-lockfile install, better-sqlite3 native addon, actual product migrations, preservation of existing local configuration/data |
| `npm test` | 6 passed, 0 failed/skipped | Three statistical/CSV cases, two database/migration cases, one comprehensive real HTTP/Socket.IO/database workflow with the scenarios below |
| `npm run lint` | Passed | ESLint across application, server, scripts and tests |
| `npm run typecheck` | Passed | Strict application and custom-server TypeScript checks |
| `npm run build` | Passed | Next.js production build and compiled Express/Socket.IO server |
| `npm run test:browser` | 3 passed, 0 skipped | Production-backed Chromium workflow in independent moderator/display/two tablet-sized contexts, plus simulated IndexedDB denial and an old-run credential/queue recovery case |
| `npm audit --omit=dev` | No vulnerabilities reported | Installed production dependency graph at the time of this check |

The comprehensive backend workflow exercises actual HTTP upload/FFprobe validation (including a fake MP4 rejection), valid/invalid video byte ranges, 20 concurrent scoped identities and submissions, duplicate sample/reaction retries, moderator login cookies, cross-project and cross-session restrictions, participant/display credential scope, stale command/report rejection, practice exclusion, separate runs and both presentation modes. It checks paused-sample flags, shared-display loss, measured drift/stall recovery, individual disconnect/reconnect, credential replacement, pending retries with the same identity, final-count receipts, known-data filtered reports/CSV, session JSON validation/import, full backup/restore with IDs preserved, unsafe archive paths, migration rollback/checksums, persisted ratings and active-state startup interruption.

Statistical cases independently check nearest-bin-centre/tie selection, one rating per participant/bin, known mean and N−1 SD, N<2 omission, missing bins without carry-forward, earliest tied peaks, matched-contributor shifts under changing coverage, missing-aggregate rejection, filters/opening exclusions and spreadsheet formula protection.

The browser workflow uses portrait and landscape tablet-sized Chromium contexts and real browser video elements and the actual UI: login, create a project/session, upload MP4, join distinct identities in independent contexts, prepare/ready/start, leave ratings unchanged between 1 Hz captures, change the slider, press the reaction button twice, collect to SQLite, go offline, retain the IndexedDB queue, reconnect/reload with the same identity, pause/end, reconcile final counts, review the real report and download CSV and a PNG with a valid PNG signature. It then switches to Individual Tablet Mode, checks playback/readiness, observes reported drift, records local-video samples, and pauses/re-aligns/resumes/ends a distinct run. Chart clicks and key-moment timestamps are checked against the actual review player. The second test injects a `QuotaExceededError` at IndexedDB opening and verifies an explicit storage warning and an unready participant. The third test deliberately leaves a shared-mode tablet offline with a durable queue and no uploaded ratings; a fresh browser with a replacement credential must not certify zero expected uploads. Reopening the recovery link in the original browser uploads its queue with the same identity and reconciles the run.

One completed Chromium run observed absolute reported drift of **0.8 ms and 1.3 ms at the checked two-context snapshot**, below the 300 ms target. This is a **single simulated browser snapshot**, not a measured bound, actual screen/audio synchronisation result or physical tablet/Wi-Fi performance claim. Results vary with scheduling and network load; the reporting dashboard exposes observed run diagnostics.

## Not established by these checks

- Real iPad Safari or Android Chrome behavior, mobile OS background/lock policies, headphone/audio routing, real user-gesture autoplay restrictions and wake-lock lifecycle on physical devices.
- Twenty simultaneous video-playing physical tablets, 20-device Wi-Fi throughput, room interference, thermal/battery behavior, a full-length live focus group or frame/audio-accurate physical synchronisation.
- Your Mac’s firewall, actual LAN reachability, tablet certificate installation, Caddy/HTTPS configuration, private-server service management or a real-world power/network outage.
- Hostile public-internet deployment, enterprise identity integration or multi-server operation. No public deployment was performed.

Follow [the physical-tablet checklist](tablet-rehearsal.md) with your actual room/equipment and intended participant capacity. Remaining operational/product limitations are listed in the README. Keep results provisional if an included identity has not reconciled, and disclose coverage/timing gaps even when uploads are reconciled.
