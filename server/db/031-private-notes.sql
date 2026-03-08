-- VouchFour Migration 031: Private User Notes
-- Run: psql -d vouchfour -f server/db/031-private-notes.sql

CREATE TABLE IF NOT EXISTS person_notes (
    id          SERIAL PRIMARY KEY,
    author_id   INTEGER NOT NULL REFERENCES people(id),
    subject_id  INTEGER NOT NULL REFERENCES people(id),
    note_text   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(author_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_person_notes_author ON person_notes(author_id);
