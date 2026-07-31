-- Stable identity for photo placement.
--
-- Placement was stored as (segment_id, plan_id, day_date, block_index). Both
-- day_date and block_index change under ordinary editing: re-dating a day
-- orphaned its photos into "not on the itinerary", and reordering the stops in
-- a day scrambled which stop each photo hung off. Days and blocks now carry a
-- stable `id` in the trip document (see assignEntityIds in lib/server/trips.ts),
-- and these columns let a photo reference that instead.
--
-- Deliberately additive: both columns are nullable, and day_date/block_index
-- are NOT dropped. Reads resolve by id first and fall back to the old columns,
-- so a row that has not been backfilled keeps working exactly as before and no
-- step of this change can lose a placement.
ALTER TABLE trip_photos ADD COLUMN day_id TEXT;
ALTER TABLE trip_photos ADD COLUMN block_id TEXT;

-- The day strip and the per-stop strips both group by day first.
CREATE INDEX idx_trip_photos_day_id ON trip_photos(trip_id, day_id);
