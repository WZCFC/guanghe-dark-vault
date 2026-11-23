CREATE TABLE online_rooms (
  code TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  queued INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX online_one_waiting_room ON online_rooms (queued) WHERE queued = 1;
--> statement-breakpoint
CREATE INDEX online_room_expiry ON online_rooms (expires_at);
