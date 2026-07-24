-- Schema for the Postgres DB behind lib/db.js. Applied automatically on first init by the
-- docker-compose.yml postgres service (docker-entrypoint-initdb.d only runs against an empty
-- data directory - see docker-compose.yml's note on `docker compose down -v`).

CREATE TABLE acc (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  userkey       text UNIQUE NOT NULL,
  userdata      text NOT NULL,
  remoteaddress text,
  lastconnection timestamptz DEFAULT now(),
  coins         integer NOT NULL DEFAULT 0
);

CREATE TABLE wrs (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name   text NOT NULL,
  score  bigint NOT NULL,
  tank   text,
  gm     text,
  key    text,
  date   timestamptz DEFAULT now()
);
CREATE INDEX wrs_score_idx ON wrs (score DESC);

CREATE TABLE shop (
  class text NOT NULL,
  id    integer NOT NULL,
  label text,
  price integer NOT NULL,
  PRIMARY KEY (class, id)
);

CREATE TABLE devs (
  password text PRIMARY KEY,
  level    integer NOT NULL
);

-- Optional seed data for exercising shop/dev-command paths locally; safe to delete.
-- INSERT INTO shop (class, id, label, price) VALUES ('basic', 0, 'Test Pet', 1000);
-- INSERT INTO devs (password, level) VALUES ('changeme', 3);
