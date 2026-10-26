Build a working browser-based dial-testing application for Beacon Consulting to use during face-to-face Focus Group Discussions (FGDs).

Act as an experienced full-stack developer. Implement and test the application rather than only providing a plan or visual mock-up. Explain setup and operation in plain English.

## 1. Purpose and scope

Participants watch a video and continuously rate their reaction using a touch slider.

Support two presentation modes:

1. Shared Screen Mode: Video plays on a central display. Participants see only the rating interface on their tablets.
2. Individual Tablet Mode: Video plays on each participant’s tablet, alongside the slider, with playback coordinated by the moderator. Participants use headphones when audio is required.

Initial scope:
- One moderator and up to 20 participants per session.
- iPad Safari, Android Chrome and modern desktop browsers.
- One rating dimension per recording run.
- Multiple projects, sessions and video clips.
- Anonymous participant IDs and optional group tags.
- Self-contained and portable, runnable locally or on a private server.
- No third-party cloud services or AI APIs required at runtime.

Use the attached screenshot as the reporting dashboard reference. If unavailable, implement the reporting requirements below without blocking progress.

## 2. Architecture and implementation approach

Inspect the existing repository first and follow its conventions.

For a new project, use:
- TypeScript.
- Node.js with Express.
- Socket.IO for live communication.
- SQLite with a maintained database library and versioned migrations.
- React with Vite.
- A locally bundled charting library supporting the required interactive charts and PNG export.

Document any justified departures before implementing them. Avoid unnecessary dependencies and externally hosted fonts, scripts or assets.

Use a real backend, persistent database and live connections between devices. Browser-local storage alone is not sufficient for shared session functionality.

Build incrementally:
1. Complete Shared Screen Mode end to end.
2. Add the reporting dashboard and exports.
3. Implement Individual Tablet Mode.
4. Complete recovery, security and verification.

Do not stop after planning or creating a dashboard with mock data. Make reasonable decisions and continue unless a missing decision materially blocks progress.

Do not deploy publicly, purchase services or modify unrelated infrastructure.

## 3. Application views

Provide these distinct views:

### Moderator: `/moderator/:sessionId`
An authenticated interface to:
- Create projects and sessions.
- Upload and select video clips.
- Select the presentation mode before a recording run.
- Configure the rating question, endpoint labels and optional reaction button.
- Generate participant join links, QR codes and session codes.
- Monitor participant readiness, connectivity, playback and upload status.
- Start, pause, resume and end a run.
- Lock new participant entry.
- Review completed runs and export results.

### Shared display: `/display/:sessionId`
A presentation view showing:
- Video.
- Join instructions before recording.
- Necessary waiting or pause messages.

Never show moderator controls, response graphs or participant ratings on this screen.

### Participant: `/dial/:sessionId`
- Shared Mode: Rating question, slider and optional reaction button.
- Individual Mode: Video plus the same rating interface.

### Reporting: `/dashboard/:sessionId`
An authenticated dashboard for analysing separate recording runs.

Provide a project/session list so these views are accessible without manually constructing URLs.

## 4. Session and recording states

Use an explicit server-owned state machine, such as:
- Waiting.
- Preparing.
- Ready.
- Recording.
- Paused.
- Completed.
- Interrupted.

Persist state transitions.

Each viewing used for data collection must have a distinct `recording_run_id`. Practice runs must be clearly labelled and excluded from research reports by default.

Prevent presentation-mode changes and ordinary seeking during active runs. Any system-initiated playback correction must be logged.

A new viewing must never overwrite or silently merge with a previous run.

If the server restarts during a run, preserve existing data and mark the run interrupted. Do not silently resume recording.

## 5. Playback timing and synchronisation

Separate moderator control, session timing and actual media playback.

### General timing
- The moderator requests actions; the server validates and distributes them.
- The server maintains the authoritative run state and scheduled timeline.
- Estimate client/server clock offset using repeated round trips.
- Use monotonic elapsed-time measurement within a running process.
- Include a run/state version with commands so stale or duplicate commands cannot restart playback.
- Record actual playback acknowledgements and timing diagnostics.

### Shared Screen Mode
- The shared display’s actual video position is authoritative for the content being viewed.
- The display reports playback position, play/pause events, buffering, seeking and completion to the server.
- The server relays timeline anchors to participant tablets.
- Tablets estimate the current video position from these anchors.
- Pause recording if the display stalls or loses its connection.
- If the moderator disconnects during an active run, pause safely and require explicit recovery.

Shared Mode tablets have no local video player. Do not assume they can obtain `video.currentTime`.

During participant disconnection, retain estimated timing and its uncertainty. On reconnection, reconcile samples against playback-state history; flag samples whose position cannot be established reliably.

### Individual Tablet Mode
- After devices are ready, schedule playback slightly in the future using the server timeline.
- Each tablet reports actual playback position, buffered ranges, readiness, stalls and drift.
- Timestamp ratings against the participant’s actual local video position, while retaining the corresponding estimated session time.
- Define a measurable synchronisation target; initially aim for drift within 300 ms under normal conditions.
- Report observed performance rather than claiming this target was achieved without measurement.

Default recovery policy:
- If a tablet stalls, disconnects or develops substantial drift, pause the group and alert the moderator.
- Re-align devices while paused and resume only after readiness checks.
- Record the interruption and exclude responses made while paused.
- Allow the moderator to explicitly exclude an unavailable participant and continue.

Do not silently change playback speed or skip content during research recording. If an optional drift-correction mode is implemented, make it configurable, log corrections and flag affected samples. Do not promise inaudible correction or frame-perfect synchronisation.

## 6. Video delivery and mobile browser behaviour

Serve uploaded video files with correct HTTP byte-range support, including valid 206 responses and handling of invalid ranges.

Initially support browser-compatible MP4 video, preferably H.264 video with AAC audio. Validate file size, metadata and supported playback; an `.mp4` extension alone is insufficient.

Include:
- `playsinline`.
- A participant “Tap to Ready” interaction that attempts to enable playback.
- Explicit handling of rejected `video.play()` promises.
- A visible “Tap to enable playback” recovery action.
- Readiness checks again when the clip changes.

Do not assume a single interaction guarantees future autoplay.

Request preloading during preparation, but treat it as a browser hint. Check actual buffered ranges and playback readiness. Display readiness failures to the moderator and use a timeout/retry workflow.

Document recommended video encoding and network requirements. Byte-range support alone does not establish 20-device performance.

## 7. Participant interface

Provide:
- Join by code, link or QR code.
- Anonymous participant ID.
- Optional configured group tags.
- Large horizontal slider with clear endpoint labels.
- Default scale: 0–100.
- Default initial value: 50.
- Visible current score.
- Optional reaction button.
- Connection, recording and pending-upload status.
- Waiting, preparing, recording, paused and completed screens.

Individual Mode layout:
- Portrait: video above slider.
- Landscape: video beside slider where space allows.
- Keep the slider accessible during playback.
- Prevent participants from seeking, changing playback speed or independently controlling playback during recording.
- Permit necessary audio controls.

Retain the slider value when untouched. Lock collection outside the recording state.

Apply touch-gesture controls to the slider interaction area without unnecessarily disabling page scrolling, keyboard access or accessibility features.

Use the Screen Wake Lock API where available:
- Detect support.
- Handle denial and release.
- Reacquire when appropriate after visibility changes.
- Show a manual fallback advising users to adjust auto-lock settings.

Do not promise that backgrounded or sleeping browsers continue sampling. Record visibility changes and mark resulting gaps.

## 8. Capture, persistence and recovery

Capture the current rating at a target rate of 1 Hz, including unchanged ratings.

Store:
- Project, session, clip and recording-run IDs.
- Participant ID.
- Sequence number.
- Rating.
- Actual or estimated video timestamp.
- Client capture time.
- Server receipt time.
- Relevant session-time estimate.
- Playback state.
- Timing source and uncertainty/quality flags.

Do not derive response time solely from server arrival time.

Persist unacknowledged records in IndexedDB, including during normal operation. Memory may be used as a cache, but must not be the only pending-data store.

Implement:
- Batched uploads.
- Server acknowledgement only after database commit.
- Retry after connection failure.
- Deduplication using recording run, participant and sequence number.
- Refresh-safe sequence management.
- Reconnection using the existing participant identity.
- Cleanup of acknowledged local data.
- Visible pending and reconciled upload status.

Detect unavailable browser storage or quota errors and warn explicitly.

Do not fabricate missing samples or fill timer gaps with assumed ratings. Distinguish an unchanged recorded rating from a disconnected or suspended device.

Record reaction-button presses as separate timestamped events with unique event IDs. Do not infer press counts from a once-per-second button state.

## 9. Moderator monitoring

Show, where available:
- Joined and ready participants.
- Connection and last-contact status.
- Page visibility.
- Actual playback position in Individual Mode.
- Estimated latency and drift.
- Pending uploads.
- Playback or storage errors.
- Data-quality warnings.

Treat battery information as optional and omit it when unavailable.

Keep results provisional until expected uploads are reconciled. If gaps remain, show them explicitly and permit reporting with those limitations disclosed.

## 10. Reporting dashboard

Reproduce the main elements of the attached example:
- Video review player.
- Mean rating over time.
- Fixed vertical scale of 0–100.
- Shaded ±1 sample-standard-deviation band.
- Individual participant traces toggle.
- Valid participant count at each timestamp.
- Optional reaction-event count markers.
- Peak and trough markers.
- Largest positive/negative shift intervals.
- Key-moments summary table.
- Participant and group filters.
- Exclusion of the opening N seconds.
- Export controls.

Synchronise the review player and chart:
- Video playback moves the chart playhead.
- Clicking a chart point or table timestamp seeks the review video.

Use the same analysis results for graph annotations and summary tables. Do not reproduce any inconsistent timestamps in the reference image.

## 11. Analysis rules

Keep raw data immutable. Document the rules used to create per-second analysis bins.

Each participant may contribute at most one rating to a one-second bin. If multiple valid samples exist, use the sample nearest the bin’s centre, with a documented tie rule.

Do not interpolate or carry ratings across missing bins by default.

Calculate:
- Mean across valid participant ratings.
- Sample standard deviation using N−1.
- Valid participant count.
- Reaction-event counts.

For fewer than two valid ratings, omit standard deviation. Clip its visual band to 0–100 without altering the underlying values.

Peak and trough:
- Highest and lowest mean within the active analysis period.
- Use the earliest timestamp for ties and disclose tied occurrences.

Shifts:
- Configurable fixed-duration window, default three seconds.
- Compare endpoint means using the same participants with valid ratings at both endpoints.
- Show the number contributing to each shift.
- Use a configurable minimum contributor count, default two.
- Do not treat an interval crossing missing aggregate data as a valid continuous shift.
- Clearly explain that matched-participant shift values can differ from the change in the displayed overall mean when coverage changes.

Opening-second exclusions and participant filters must update all relevant statistics, markers, tables and exports consistently.

Exclude invalid timing samples by default while retaining them in raw exports.

Describe results as changes in the selected rating measure. Do not infer attention, persuasion or purchase intent unless that is explicitly what the question measures.

## 12. Exports and backup

Provide:
1. Raw ratings CSV, including quality flags.
2. Raw reaction-events CSV.
3. Per-second statistics CSV.
4. Key-moments CSV.
5. Chart PNG.
6. Full session archive containing settings, run history, raw data, events and analysis configuration.

Include filter settings, analysis rules and exclusions in exported summaries.

State whether video media is included in each archive. Provide a backup/restore procedure that preserves IDs and validates archive structure.

Protect CSV exports against spreadsheet formula injection in user-entered text fields.

## 13. Security and deployment

Implement:
- Authenticated moderator/admin access.
- Secure password handling.
- Server-side role and session checks on HTTP routes and WebSocket events.
- Scoped participant credentials that cannot impersonate another participant.
- Scoped shared-display access.
- Protected video files, dashboards, exports and archives.
- Join-code rate limiting.
- Upload limits and validation.
- Safe file paths and generated storage filenames.
- Validated inputs and parameterised database access.
- No secrets committed to source code.

Participants may receive configuration needed for their own interface, but must not receive private moderator settings, other participants’ responses or aggregate data.

Bundle runtime assets locally. Document that initial dependency installation may require internet access.

Provide:
- Local setup.
- Private-server deployment.
- An HTTPS approach suitable for tablets on the local network.
- Clear explanation that plain HTTP on a LAN address may not support secure-context browser features such as Wake Lock.
- Database and uploaded-media backup instructions.

Do not claim the system is production-ready solely because automated tests pass.

## 14. Verification

Write and run meaningful tests for:
- Concurrent participant submissions.
- Both presentation modes and state transitions.
- Known-data statistical calculations.
- Missing samples and changing participant counts.
- Reaction-event capture and deduplication.
- Buffer recovery after reconnection and refresh.
- Server-restart persistence.
- Interrupted-run recovery.
- Pauses and separate repeated viewings.
- Stale playback-command rejection.
- Participant isolation and unauthorised access attempts.
- Export consistency.
- Backup/restore.
- Video byte-range responses.

Use independent browser contexts for multi-device workflow tests where available.

A simulated 20-client test is useful, but does not prove physical tablet or Wi-Fi performance.

Report exactly:
- What was implemented.
- Which tests were executed and their outcomes.
- What could not be tested.
- Known limitations.
- Remaining physical-device checks.

Never present synthetic responses as actual collected research data. Keep demo mode separate and clearly labelled.

## 15. Deliverables

Provide:
- Working source code.
- Database schema and migrations.
- README with plain-English setup and operation.
- `.env.example` without secrets.
- Deployment and backup/restore instructions.
- Test suite and actual test results.
- Moderator run-sheet.
- Physical-tablet rehearsal checklist covering both modes.

The rehearsal checklist must cover real iPad and Android devices, autoplay, audio/headphones, screen locking, Wi-Fi interruptions, buffering, refresh/reconnection, timing accuracy and full intended participant capacity.

Treat the application as a pilot until an actual multi-tablet rehearsal has passed.