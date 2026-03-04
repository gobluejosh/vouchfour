-- Add 'claude-compact' as allowed source in person_enrichment
-- Used for compressed micro-summaries optimized for Network Brain context

ALTER TABLE person_enrichment DROP CONSTRAINT person_enrichment_source_check;
ALTER TABLE person_enrichment ADD CONSTRAINT person_enrichment_source_check
  CHECK (source = ANY(ARRAY['apollo', 'brave', 'claude', 'claude-compact']));
