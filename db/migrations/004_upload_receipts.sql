CREATE TABLE RunUpload (
  runId TEXT NOT NULL REFERENCES RecordingRun(id), participantId TEXT NOT NULL REFERENCES Participant(id),
  expectedRatings INTEGER NOT NULL, expectedReactions INTEGER NOT NULL, finalizedAt REAL NOT NULL,
  PRIMARY KEY(runId,participantId)
);
