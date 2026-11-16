CREATE TABLE entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  analysis TEXT
);
--> statement-breakpoint
CREATE INDEX entries_owner_created ON entries(owner, created DESC);
