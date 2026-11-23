CREATE TABLE discussion_threads (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment TEXT NOT NULL,
  created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE discussion_replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX discussion_threads_recent ON discussion_threads(created DESC);
--> statement-breakpoint
CREATE INDEX discussion_replies_thread ON discussion_replies(thread_id, created);
