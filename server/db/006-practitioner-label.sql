-- VouchFour Migration 006: Add practitioner_label to job_functions
-- Run: psql -d vouchfour -f server/db/006-practitioner-label.sql
--
-- Adds a natural-language label for sentence construction,
-- e.g. "Engineers" instead of "Engineering / Software Development"

ALTER TABLE job_functions ADD COLUMN IF NOT EXISTS practitioner_label TEXT;

UPDATE job_functions SET practitioner_label = CASE slug
    WHEN 'engineering'       THEN 'Engineers'
    WHEN 'product'           THEN 'Product Managers'
    WHEN 'marketing'         THEN 'Marketers'
    WHEN 'sales'             THEN 'Sales professionals'
    WHEN 'design'            THEN 'Designers'
    WHEN 'data'              THEN 'Data professionals'
    WHEN 'finance'           THEN 'Finance professionals'
    WHEN 'operations'        THEN 'Operations professionals'
    WHEN 'people-hr'         THEN 'People & HR professionals'
    WHEN 'customer-success'  THEN 'Customer Success professionals'
END
WHERE practitioner_label IS NULL;
