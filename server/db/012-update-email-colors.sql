-- ─── Update email template colors to match new indigo design ─────────────────
-- Button bg: #2563EB → #4F46E5
-- Text ink: #1C1917 → #171717
-- Text sub: #78716C / #44403C → #6B7280
-- Link color: #2563EB → #4F46E5

UPDATE email_templates
SET body_html = REPLACE(body_html, '#2563EB', '#4F46E5')
WHERE body_html LIKE '%#2563EB%';

UPDATE email_templates
SET body_html = REPLACE(body_html, '#1C1917', '#171717')
WHERE body_html LIKE '%#1C1917%';

UPDATE email_templates
SET body_html = REPLACE(body_html, '#44403C', '#6B7280')
WHERE body_html LIKE '%#44403C%';

UPDATE email_templates
SET body_html = REPLACE(body_html, '#78716C', '#6B7280')
WHERE body_html LIKE '%#78716C%';
