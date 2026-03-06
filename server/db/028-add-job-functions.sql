-- 028: Add 9 new job functions and reorder all alphabetically
-- New: Clinicians, Coaches, Communications/PR, Consultants, Educators, Founders, Generalists, People Managers, Strategists

INSERT INTO job_functions (name, slug, practitioner_label, display_order) VALUES
  ('Clinicians', 'clinicians', 'Clinicians', 99),
  ('Coaches', 'coaches', 'Coaches', 99),
  ('Communications / PR', 'communications', 'Communications professionals', 99),
  ('Consultants', 'consultants', 'Consultants', 99),
  ('Educators', 'educators', 'Educators', 99),
  ('Founders', 'founders', 'Founders', 99),
  ('Generalists', 'generalists', 'Generalists', 99),
  ('People Managers', 'people-managers', 'People Managers', 99),
  ('Strategists', 'strategists', 'Strategists', 99)
ON CONFLICT DO NOTHING;

-- Reorder all alphabetically
UPDATE job_functions SET display_order = 1  WHERE slug = 'clinicians';
UPDATE job_functions SET display_order = 2  WHERE slug = 'coaches';
UPDATE job_functions SET display_order = 3  WHERE slug = 'communications';
UPDATE job_functions SET display_order = 4  WHERE slug = 'consultants';
UPDATE job_functions SET display_order = 5  WHERE slug = 'customer-success';
UPDATE job_functions SET display_order = 6  WHERE slug = 'data';
UPDATE job_functions SET display_order = 7  WHERE slug = 'design';
UPDATE job_functions SET display_order = 8  WHERE slug = 'educators';
UPDATE job_functions SET display_order = 9  WHERE slug = 'engineering';
UPDATE job_functions SET display_order = 10 WHERE slug = 'executive';
UPDATE job_functions SET display_order = 11 WHERE slug = 'finance';
UPDATE job_functions SET display_order = 12 WHERE slug = 'founders';
UPDATE job_functions SET display_order = 13 WHERE slug = 'general-management';
UPDATE job_functions SET display_order = 14 WHERE slug = 'generalists';
UPDATE job_functions SET display_order = 15 WHERE slug = 'investor';
UPDATE job_functions SET display_order = 16 WHERE slug = 'legal';
UPDATE job_functions SET display_order = 17 WHERE slug = 'marketing';
UPDATE job_functions SET display_order = 18 WHERE slug = 'operations';
UPDATE job_functions SET display_order = 19 WHERE slug = 'people-hr';
UPDATE job_functions SET display_order = 20 WHERE slug = 'people-managers';
UPDATE job_functions SET display_order = 21 WHERE slug = 'product';
UPDATE job_functions SET display_order = 22 WHERE slug = 'sales';
UPDATE job_functions SET display_order = 23 WHERE slug = 'strategists';
