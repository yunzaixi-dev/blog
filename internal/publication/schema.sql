BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY);
CREATE SEQUENCE IF NOT EXISTS release_revision_seq;
CREATE TABLE IF NOT EXISTS releases (
  revision bigint PRIMARY KEY DEFAULT nextval('release_revision_seq'),
  source_sha text NOT NULL,
  snapshot jsonb NOT NULL,
  search_collections jsonb NOT NULL,
  media_manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publication (
  id integer PRIMARY KEY CHECK(id=1),
  active_revision bigint REFERENCES releases(revision),
  desired_source_sha text NOT NULL DEFAULT '',
  phase text NOT NULL CHECK(phase IN ('syncing','ready','failed')),
  error_code text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO publication(id,phase) VALUES(1,'syncing') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF current_database()='blog' AND current_user='blog_migrator' THEN
    REVOKE CONNECT,TEMPORARY ON DATABASE blog FROM PUBLIC;
    GRANT CONNECT ON DATABASE blog TO blog_reader,blog_publisher,blog_migrator;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='blog_reader') THEN
    GRANT USAGE ON SCHEMA public TO blog_reader;
    GRANT SELECT ON releases,publication TO blog_reader;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='blog_publisher') THEN
    GRANT USAGE ON SCHEMA public TO blog_publisher;
    GRANT SELECT,INSERT ON releases TO blog_publisher;
    GRANT SELECT,UPDATE ON publication TO blog_publisher;
    GRANT USAGE,SELECT ON SEQUENCE release_revision_seq TO blog_publisher;
  END IF;
END $$;
COMMIT;
