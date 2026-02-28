-- Drop legacy tables no longer used after pivot to job-function chain model
-- roles, role_invites, role_people: disabled role-search feature
-- edges: old graph model, replaced by vouches table

DROP TABLE IF EXISTS role_people;
DROP TABLE IF EXISTS role_invites;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS edges;
