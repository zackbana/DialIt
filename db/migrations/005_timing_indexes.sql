ALTER TABLE Reaction ADD COLUMN reconciledVideoMs REAL;
CREATE INDEX playback_run_capture ON PlaybackEvent(runId,role,capturedServerAt DESC);
CREATE INDEX transition_run_capture ON RunTransition(runId,serverAt DESC,version DESC);
CREATE INDEX participant_session ON Participant(sessionId);
CREATE INDEX recording_session ON RecordingRun(sessionId,createdAt DESC);
CREATE INDEX reaction_run_time ON Reaction(runId,videoMs);
CREATE INDEX diagnostic_session ON Diagnostic(sessionId,serverAt);
