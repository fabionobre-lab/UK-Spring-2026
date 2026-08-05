-- Admin-triaged roadmap overlay (P4, feedback→roadmap triage).
--
-- roadmap.json stays the committed BASE snapshot; this table holds the
-- runtime overlay the admin writes from /admin/roadmap: rows either override
-- a base item (same id), add a new item, or retire a base item (hidden = 1).
-- A Worker cannot write to the bundled JSON, which is why the overlay exists.
--
-- The bilingual pair is stored as two NOT NULL title columns on purpose: the
-- "no half-translated item reaches the public page" invariant that
-- test/roadmap.test.ts asserts over the snapshot is enforced here at the
-- schema level too. Notes are nullable but both-or-neither (checked in
-- $lib/server/roadmap.ts, which SQLite can't express as cleanly).
--
-- created_at / updated_at are epoch milliseconds (Date.now()), matching the
-- feedback and share-links convention.
CREATE TABLE roadmap_items (
	id TEXT PRIMARY KEY,
	title_en TEXT NOT NULL,
	title_pt TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('shipped', 'building', 'planned')),
	note_en TEXT,
	note_pt TEXT,
	hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
	-- Provenance: the feedback submission this entry was accepted from, when
	-- it came from triage rather than being added by hand. ON DELETE SET NULL
	-- so deleting an account (which deletes its feedback) never strands or
	-- removes a published roadmap entry.
	feedback_id TEXT REFERENCES feedback(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX idx_roadmap_items_created ON roadmap_items(created_at);
CREATE INDEX idx_roadmap_items_feedback ON roadmap_items(feedback_id);
