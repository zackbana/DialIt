CREATE TABLE Moderator (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','moderator')), createdAt REAL NOT NULL
);
CREATE TABLE AuthSession (
  tokenHash TEXT PRIMARY KEY, moderatorId TEXT NOT NULL REFERENCES Moderator(id), expiresAt REAL NOT NULL
);
CREATE TABLE Project (
  id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES Moderator(id), name TEXT NOT NULL, createdAt REAL NOT NULL
);
CREATE TABLE Clip (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES Project(id), title TEXT NOT NULL,
  filename TEXT NOT NULL UNIQUE, durationMs REAL NOT NULL, bytes INTEGER NOT NULL, metadata TEXT NOT NULL
);
CREATE TABLE Session (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES Project(id), name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, config TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0,
  displayTokenHash TEXT, currentRunId TEXT, createdAt REAL NOT NULL
);
CREATE TABLE Participant (
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES Session(id), tokenHash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL, groupTag TEXT NOT NULL DEFAULT '', createdAt REAL NOT NULL,
  telemetry TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE RecordingRun (
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES Session(id), clipId TEXT NOT NULL REFERENCES Clip(id),
  config TEXT NOT NULL, practice INTEGER NOT NULL, state TEXT NOT NULL,
  version INTEGER NOT NULL, positionMs REAL NOT NULL DEFAULT 0, anchorAt REAL NOT NULL,
  createdAt REAL NOT NULL, endedAt REAL
);
CREATE TABLE RunParticipant (
  runId TEXT NOT NULL REFERENCES RecordingRun(id), participantId TEXT NOT NULL REFERENCES Participant(id),
  excluded INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(runId, participantId)
);
CREATE TABLE RunTransition (
  id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES RecordingRun(id), version INTEGER NOT NULL,
  state TEXT NOT NULL, positionMs REAL NOT NULL, serverAt REAL NOT NULL, reason TEXT NOT NULL,
  UNIQUE(runId,version)
);
CREATE TABLE PlaybackEvent (
  id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES RecordingRun(id), participantId TEXT,
  role TEXT NOT NULL, kind TEXT NOT NULL, positionMs REAL NOT NULL, serverAt REAL NOT NULL,
  capturedServerAt REAL NOT NULL, details TEXT NOT NULL
);
CREATE TABLE Rating (
  runId TEXT NOT NULL REFERENCES RecordingRun(id), participantId TEXT NOT NULL REFERENCES Participant(id),
  sequence INTEGER NOT NULL, projectId TEXT NOT NULL, sessionId TEXT NOT NULL, clipId TEXT NOT NULL,
  value REAL NOT NULL CHECK(value BETWEEN 0 AND 100), videoMs REAL NOT NULL,
  clientCapturedAt REAL NOT NULL, capturedServerAt REAL NOT NULL, receivedAt REAL NOT NULL,
  sessionMs REAL NOT NULL, playbackState TEXT NOT NULL, timingSource TEXT NOT NULL,
  uncertaintyMs REAL NOT NULL, flags TEXT NOT NULL,
  PRIMARY KEY(runId,participantId,sequence)
);
CREATE INDEX rating_run_time ON Rating(runId,videoMs);
CREATE TABLE Reaction (
  id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES RecordingRun(id), participantId TEXT NOT NULL REFERENCES Participant(id),
  videoMs REAL NOT NULL, clientCapturedAt REAL NOT NULL, capturedServerAt REAL NOT NULL,
  receivedAt REAL NOT NULL, flags TEXT NOT NULL
);
CREATE TABLE Diagnostic (
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES Session(id), runId TEXT,
  participantId TEXT, kind TEXT NOT NULL, serverAt REAL NOT NULL, details TEXT NOT NULL
);
