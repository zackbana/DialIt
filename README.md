# DialIt — Beacon Consulting

A working browser-based video dial-testing pilot for face-to-face focus groups. Participants continuously rate one moderator-defined question on a 0–100 touch slider. Actual ratings, reactions, playback diagnostics, and separate recording runs are stored in SQLite.

The existing Next.js App Router, TypeScript, Express, Socket.IO and better-sqlite3 foundation is retained. Next.js replaces the specification’s new-project Vite suggestion because this repository already uses Next.js and the requested architecture explicitly retains it. Chart.js, QR generation and other browser assets are bundled locally; no cloud service or AI API is required at runtime.

**Treat this as a research pilot until the [physical-tablet rehearsal](docs/tablet-rehearsal.md) passes.** Automated browser tests are not evidence of 20 physical tablets or Wi-Fi/audio synchronisation performance.

## What is implemented

- Password-protected moderator access with scrypt password hashes and revocable, expiring HttpOnly login cookies; admin and project-owner checks on HTTP and Socket.IO actions.
- Project/session list, clip library, six-digit join codes, join links/QR codes, anonymous participant identities, optional configured groups, entry locking and private device-recovery links.
- H.264/AAC MP4 validation using FFprobe; generated filenames, upload limits and protected byte-range media delivery.
- **Shared Screen Mode:** a scoped presentation-only display plays the video. Tablets have no video player and use display playback anchors for estimated content timing. Display buffering/heartbeat loss and moderator loss pause the run.
- **Individual Tablet Mode:** video beside/before the slider, inline playback, explicit Tap to Ready, actual local media timestamps, readiness/buffer checks, scheduled starts/resumes, observed drift monitoring and conservative group pauses. No hidden speed correction or seeking during recording.
- Server-owned preparing/ready/recording/paused/completed/interrupted states, versioned commands, persisted transitions and distinct IDs for every viewing. Practice runs are visibly labelled and excluded from research reporting by default.
- Target 1 Hz sampling, including untouched ratings; unique reaction events; IndexedDB-first queues, atomic refresh-safe sequences, acknowledged batched uploads, retries, deduplication and end-of-run count reconciliation. No invented samples or timer-gap filling.
- Moderator monitoring of connectivity, readiness, visibility, positions, drift/latency, pending uploads, storage/playback errors and quality flags. Interrupted runs remain available after restart and never silently resume.
- Authenticated reporting with video review/playhead seeking, mean, sample SD band, valid N, individual traces, reactions, peaks/troughs, matched-participant shifts, opening exclusions and participant/group filters.
- Raw-rating, raw-reaction, statistics and key-moment CSVs; chart PNG with analysis/filter captions; session JSON archives; validated session import; full database/media backups and restoration preserving IDs.

There is no seeded research/demo dataset. Automated tests generate explicitly labelled synthetic video/data in temporary, isolated databases. The old foundation’s `Message` table remains solely for migration compatibility; its API and UI are removed and it is never used by reporting.

## Run on your Mac

Install Node.js **24 LTS**, npm, Apple Command Line Tools and FFmpeg. If you use Homebrew/nvm:

```sh
xcode-select --install                  # once, if Command Line Tools are missing
brew install ffmpeg                    # provides ffmpeg and ffprobe
# Install nvm separately if you do not already have it, then:
nvm install 24
nvm use 24
```

From the repository directory:

```sh
npm ci
npm run setup
npm run moderator:create -- --username admin
npm run dev
```

The account command asks for a **hidden password of 12–200 characters**. There is no default password and it refuses to overwrite an existing account. For unattended setup, inject `DIALIT_ADMIN_PASSWORD` securely into that one command’s process environment; do not put a real password in source code, command-line arguments or shared `.env` files.

Open `http://localhost:3000` on your Mac and log in. `npm run setup` preserves an existing `.env`, applies versioned SQL migrations transactionally, and does not reset data. The development server restarts when server code changes; use the production command for an actual rehearsal/FGD so edits do not interrupt the run.

For a normal recording session:

```sh
npm run build
npm start
```

Stop the development server first so only one server uses the database/port. **Use `npm start`, not `next start`**: the custom server owns Next.js, Express and persistent WebSockets on one port. Keep the terminal open and prevent the Mac itself from sleeping. On other systems, better-sqlite3 also requires a C++ compiler, make, Python 3 and matching Node headers for its native addon. Initial npm/Node-header downloads need internet access; recordings do not.

## Join from a tablet on the same Wi-Fi

1. Connect the Mac, shared display and tablets to the same trusted network. Avoid guest Wi-Fi/client-isolation networks. Prefer an Ethernet connection for the server and central display where possible.
2. Find the Mac’s LAN address under **System Settings → Wi-Fi → Details → TCP/IP** (for example `192.168.1.50`). Allow Node through the macOS firewall for your trusted local network. The default `HOST=0.0.0.0` listens on the LAN.
3. On the Mac, open **`http://192.168.1.50:3000`**, log in there, and open the moderator session. Generate the QR/link from this address so it contains the LAN host. `localhost` on a tablet points to the tablet, not your Mac.
4. On each tablet, open that LAN address and choose **Join a session**, enter the six-digit code, or scan the session QR. Choose a configured group if instructed. Bookmark the resulting `/dial/...` page and retain this browser’s data.
5. For Shared Mode, generate/open the private shared-display link on the central screen. For Individual Mode, use headphones as required and confirm audio separately on every tablet. Prepare a viewing and have every included device tap Ready before starting.

Plain LAN HTTP can be useful for an initial trusted-network pilot, but does **not** encrypt passwords/device credentials and may not support secure-context features such as Wake Lock. Use the [local HTTPS/private-server instructions](docs/deployment.md) for a rehearsal involving real participants/data. Installing a certificate on the Mac alone does not make tablets trust it.

## Operation

Read the [moderator run-sheet](docs/moderator-run-sheet.md) before running a group.

- Create a project, then a session. `/moderator/:sessionId` handles clips, configuration and run controls; `/display/:sessionId` is scoped presentation-only; `/dial/:sessionId` is the tablet view; `/dashboard/:sessionId` is authenticated reporting.
- Upload a compatible clip, choose the mode, question, endpoint labels, optional reaction button and comma-separated group tags; **Save configuration** before preparing the next run. Mode/clip/question settings are frozen during the prepared/active viewing.
- Join up to **20 identities** in a session, then prepare a viewing. Readiness is reset for the new run/clip. Shared tablets tap Ready; media devices also attempt playback and check real buffering. A failed readiness attempt remains visible and can be retried. Preparing devices that are still unready after 60 seconds produce a readiness-timeout warning.
- Start/resume is scheduled 1.5 seconds ahead. Playback acknowledgements and diagnostics are recorded separately from moderator commands. Server elapsed time uses a monotonic process clock; clients estimate offset with repeated round trips.
- Pause locks capture. After a pause, media devices align to the paused position, log that correction and must tap Ready again. Resume is disabled until all included devices pass readiness. No playback-speed adjustment or silent skip is performed during research recording.
- Individual-mode buffering, disconnects, hidden pages or measured drift above 300 ms pause the group; shared-display problems and moderator loss also pause safely. A heartbeat timeout may take several seconds to detect a lost network. Exclude an unavailable participant explicitly while preparing/paused before continuing.
- Shared-mode disconnected tablets retain estimated timing and uncertainty. On receipt, samples are reconciled with stored display/state history. Uncertain, unreconciled or outside-recording samples are retained in raw data and excluded from default analysis. Individual tablets pause locally when disconnected and do not pretend to keep sampling in the background.
- End the viewing. Keep tablets open until pending records are acknowledged **and final capture counts are reconciled**. A report stays provisional if any included identity has not reconciled. Coverage gaps are still disclosed even after upload reconciliation.
- For a lost/refreshed device, reopen the same `/dial/...` page. Re-entering the session code on the same browser reuses its identity. If the identity/credential was lost, end the viewing first and use **Recover device** between viewings to issue a private scoped link preserving the participant ID and revoke the previous credential. Keep an old browser’s pending queue until it has been recovered/reconciled. A new browser cannot certify an old run’s expected upload counts; reopen the recovery link in the original browser to recover its persisted queue. If a device is unavailable during a run, pause and explicitly exclude it rather than replacing its credential mid-run.
- A new viewing always creates a new recording-run ID. A server stop/restart marks active viewings **interrupted**; prepare an explicitly new viewing. Existing raw data stays intact.

Screen Wake Lock is requested where available, handles release/denial and is reacquired after appropriate visibility changes. If unavailable, the UI advises manually disabling auto-lock. Hidden/sleeping browsers are not assumed to sample; visibility changes and detected timer gaps are logged.

## Analysis and exports

Bins are labelled by their starting second and represent `[s, s+1)`. Each participant contributes at most one valid rating: the sample nearest the bin centre `s+0.5`, with lower sequence number breaking equal-distance ties. Shared Mode uses the separately stored reconciled timestamp where available; original timestamps remain in raw exports. There is **no interpolation or carry-forward** over missing bins.

Mean uses the valid selected ratings in that bin. SD uses **N−1**, is omitted for N<2, and its display band is clipped to 0–100 without changing the numeric SD. Tooltip/CSV shows valid N and reaction counts. Flagged timing, excluded participants and practice runs are excluded by default; flagged data can be explicitly included for sensitivity analysis.

Peaks/troughs use the highest/lowest eligible mean; ties disclose occurrence count and select the earliest bin. Shifts use a configurable fixed window (default 3 seconds), participants present at **both endpoints**, minimum contributors (default 2), and continuous aggregate coverage. A matched-participant shift can differ from the change in the overall mean as coverage changes. All markers, tables and summary exports use the same calculation/filter results. Describe findings only as changes in the configured rating measure.

Raw CSV exports always retain all original run rows/flags, including excluded rows; their metadata explains this policy. Summary CSV and PNG exports use active filters. CSV text is quoted and protected against spreadsheet formula injection. Chart clicks and table timestamps seek the review video, and video playback moves the chart playhead.

The **session JSON archive excludes video and credential hashes**, but includes settings, all runs (including practice), raw data, transitions, playback/diagnostic events, upload receipts and analysis configuration. Restore it with the server stopped:

```sh
npm run session:restore -- /path/to/session-archive.json --owner admin
```

The target account must exist. Import validates structure, ID scope, SQL relationships and generated media paths; it preserves IDs, refuses session/code collisions and never overwrites existing recordings. Active imported runs become interrupted. Copy the original UUID-named MP4 files into `MEDIA_DIR` separately, regenerate the display link and use private participant recovery links if devices will be reused. Until media is restored, the report still has data but video review returns a clear missing-media error. For exact whole-installation restoration, use the full backup below.

## Data, backup and restore

Defaults (see `.env.example`):

| Setting | Default / use |
| --- | --- |
| `DATABASE_URL` | `file:./data/dev.db`, relative to the repository root; a local SQLite file path is also accepted |
| `MEDIA_DIR` | `./data/media` |
| `HOST`, `PORT` | `0.0.0.0`, `3000` |
| `MAX_UPLOAD_MB` | `500` (maximum accepted configuration 2000 MB) |
| `FFPROBE_PATH` | `ffprobe` on PATH |
| `COOKIE_SECURE` | `false` for trusted local HTTP development; set `true` behind HTTPS |
| `TRUST_PROXY` | `false`; set `true` only behind your trusted single reverse proxy |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin, including a non-default port, for the private proxy |

Keep `.env`, database/WAL files, media, backups, certificate keys and device links private. `.gitignore` excludes default data and local secrets. Do not copy only a live SQLite `.db` while ignoring its WAL.

```sh
# Consistent SQLite backup plus every referenced uploaded clip and a SHA-256 manifest:
npm run backup -- /absolute/path/to/private-backup-folder
```

Backup uses SQLite’s backup API and checks/copies the referenced media. The destination must be new; a missing clip fails the backup rather than claiming it is complete. Full backups contain credentials and research data; store them privately and securely. No active playback is promised to survive restoration.

To restore: stop the server, preserve/move the old data directory as a precaution, then restore into **empty** database/media paths:

```sh
npm run restore -- /absolute/path/to/private-backup-folder
npm run setup
npm run build
npm start
```

Restore validates the manifest, safe paths, checksums, SQLite integrity, foreign keys and media coverage; it refuses existing database/nonempty media destinations. It preserves original IDs, credentials and media. For a restore rehearsal without moving current data, override `DATABASE_URL` and `MEDIA_DIR` with new empty locations. Restore commands require the server to be stopped. Add new numbered SQL migrations; never edit applied migrations, whose checksums are verified.

## Verification

```sh
npm test                   # real backend, statistics, migration and backup/import tests
npm run test:smoke         # backend dial workflow, including 20 simulated connections
npm run lint
npm run typecheck
npm run build
# Requires Chromium: npx playwright install chromium (or set CHROMIUM_PATH).
npm run test:browser       # isolated production server, separate browser contexts
```

FFmpeg/FFprobe are needed for video validation and test-video generation. Browser tests use an isolated temporary database and a test-only account; they never populate the normal recording database. See [verification evidence and limitations](docs/verification.md) for exact executed checks. `CHROMIUM_PATH` can select an installed compatible Chromium; this cloud environment uses `/usr/bin/chromium`.

## Remaining limitations

- Pilot/single-instance design: one moderator and up to 20 enrolled identities per session. There is no distributed Socket.IO adapter, multi-server SQLite writer design, enterprise SSO, account-management UI or public SaaS deployment. Run only on a trusted LAN/private server; do not expose it publicly without a separate deployment/security review.
- Physical iPad Safari/Android Chrome, real audio/headphones, tablet autoplay/Wake Lock behavior, router capacity, server sleep and full 20-device throughput/timing must still be rehearsed. The 300 ms individual-mode drift target is monitored, not guaranteed. Browser reports are not frame-accurate screen/audio measurements.
- At most one active browser connection per scoped participant/display credential. Multiple tabs deliberately replace the older connection and may cause a safety pause.
- Capture needs a visible, awake browser and working persistent storage. Clearing browser data, private-mode eviction or losing a device can lose its unuploaded queue. Final receipts expose unreconciled identities; no missing data is invented.
- H.264 MP4 (up to 4K) with optional AAC audio only. Other codecs/transcoding, editing videos, arbitrary active-run seeking and playback-speed correction are intentionally unsupported. Use 720p/1080p, `yuv420p`, AAC and `+faststart`; lower bitrate/resolution for many tablets. A useful starting point is 2–4 Mbps at 720p; **20 × 4 Mbps already requires over 80 Mbps plus network overhead**. Byte-range tests do not establish Wi-Fi capacity.
- Session JSON is a data archive, not a media/credential backup. JSON export/import is memory-based and intended for ordinary focus-group lengths; use full database backups for large datasets. Keep original clips and verify the checksum-bearing full backup before deleting anything.
