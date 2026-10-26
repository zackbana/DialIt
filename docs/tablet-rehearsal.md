# Physical-tablet rehearsal — required before research use

Run this checklist with the actual Mac/private server, access point, central display, **real iPads running Safari and Android tablets running Chrome**, actual headphones and intended participant capacity (up to 20). Record device/browser versions, video encoding/bitrate, network setup, date, operator, failures and measured timings. Automated/simulated clients do not satisfy this checklist.

## Both modes

- [ ] All devices can reach the same LAN/HTTPS host; guest/client isolation is disabled. Certificate trust is verified on each tablet, not only on the Mac. No device uses localhost for the server.
- [ ] Login and private display/participant credentials remain scoped. Public QR/code gives only joining access. The shared display never reveals responses, analysis or moderator controls.
- [ ] Join all intended devices with distinct IDs/groups; lock entry and verify an additional join is rejected. Check landscape/portrait layouts, large slider, endpoint labels, keyboard/accessibility support and retained untouched values.
- [ ] Validate real clip metadata/playback, duration, first/last frame and audio. Rehearse long clips at the intended bitrate. Observe readiness, buffering, server CPU/disk and access-point load at full capacity; a 206 response alone is not enough.
- [ ] Test initial Tap to Ready, rejected autoplay and visible recovery action on each browser. Repeat after pauses and **clip changes**, and verify readiness resets. Exercise timeout/retry; do not bypass failures.
- [ ] Test Wake Lock support, denial, release and reacquisition after visibility changes. On LAN HTTP, confirm the manual auto-lock fallback. Lock/unlock the physical screen, background/foreground the browser and confirm gaps are flagged/logged rather than fabricated.
- [ ] Test Mac sleep prevention and power loss/restart. Active runs must become interrupted, data must remain available, and explicit new viewings must be required.
- [ ] Move one tablet out of Wi-Fi range, toggle Wi-Fi, refresh/reopen the browser and restart the access point. Verify identity/sequence recovery, IndexedDB pending data, deduplication and final reconciliation. Never clear browser data while records are pending.
- [ ] Simulate blocked/full storage and verify an explicit warning and safe pause/readiness failure. Check pending uploads and receipts for every identity; acknowledge any unrecoverable gap explicitly.
- [ ] Verify pauses collect no valid research ratings, Resume waits for included readiness, excluded devices cannot silently contribute, and repeated viewings get distinct IDs. Practice is visibly separate and absent from default reports.
- [ ] Verify distinct reaction presses are counted exactly once, even when retrying uploads. Export raw flags, statistics, moments, PNG and archive, and reconcile totals against observations.
- [ ] Perform a **full backup/restore** into empty paths. Confirm stable IDs, credentials, media, checksums and interrupted-state policy. Also rehearse session JSON import with separately restored media and regenerated device links.

## Shared Screen Mode

- [ ] Only the central display plays media; tablets contain no video player. Observe content timing on the physical display against tablet samples using a video with visible timecode/flashes.
- [ ] Pause the display, force buffering, unplug its network and close its tab. Recording must pause safely; estimated tablet timestamps and uncertainty must remain auditable.
- [ ] Disconnect a shared-mode tablet while display playback continues. Reconnect/refresh and verify queued samples reconcile against actual display/state history; unreliable samples stay flagged.
- [ ] Close/disconnect the moderator during playback. Confirm a safe pause and explicit recovery, not automatic silent continuation.

## Individual Tablet Mode

- [ ] Confirm headphones, usable volume and independent mute controls on **every** device. Verify inline video and slider access in both orientations; there must be no ordinary seek/speed controls during research recording.
- [ ] Measure actual screen/audio alignment across devices with visible timecode and an independent recording/high-frame-rate camera or equivalent. Compare it to logged telemetry and the ±300 ms target; do not infer physical accuracy from the telemetry alone.
- [ ] Force one tablet to buffer, disconnect or drift. Confirm local/group pause, visible reason, alignment while paused, logged corrections, readiness checks and explicit Resume.
- [ ] Exclude an unavailable tablet and continue with known included identities; re-inclusion requires readiness. Check the report’s matched-participant shifts and changing coverage.
- [ ] Repeat at full intended capacity, for the longest expected session, with real room Wi-Fi interference. Document worst observed drift, buffering, battery/power conditions and upload completion time.

Sign off only after failures are resolved or disclosed in the study protocol. Until then, DialIt remains a pilot.
