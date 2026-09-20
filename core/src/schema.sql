-- SIXDOGS core schema. Safe to run repeatedly (everything is IF NOT EXISTS).

-- One row per detected match.
CREATE TABLE IF NOT EXISTS matches (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  map          TEXT,
  start_reason TEXT,          -- why we decided a new match began (clock reset, map change, ...)
  final_status JSONB          -- last /v1/status seen before the match ended
);

-- One row per successful poll: the raw /v1/status answer.
CREATE TABLE IF NOT EXISTS status_samples (
  id        BIGSERIAL PRIMARY KEY,
  polled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  match_id  BIGINT REFERENCES matches(id),
  status    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS status_samples_polled_at ON status_samples (polled_at);

-- One row per player per poll. Pruned after SAMPLE_RETENTION_DAYS.
CREATE TABLE IF NOT EXISTS player_samples (
  sample_id BIGINT NOT NULL REFERENCES status_samples(id) ON DELETE CASCADE,
  match_id  BIGINT REFERENCES matches(id),
  steam_id  TEXT NOT NULL,
  name      TEXT NOT NULL,
  faction   TEXT,
  kills     INTEGER,
  deaths    INTEGER,
  cash      BIGINT,          -- persistent wallet across matches, NOT a match score
  ping_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS player_samples_match ON player_samples (match_id, steam_id);
CREATE INDEX IF NOT EXISTS player_samples_sample ON player_samples (sample_id);

-- Everyone we have ever seen on the server. Kept forever (small).
CREATE TABLE IF NOT EXISTS players (
  steam_id   TEXT PRIMARY KEY,
  last_name  TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discord <-> Steam links, created by /verify.
CREATE TABLE IF NOT EXISTS links (
  discord_id  TEXT PRIMARY KEY,
  steam_id    TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pending verification codes (one per Discord user at a time).
CREATE TABLE IF NOT EXISTS verify_codes (
  discord_id TEXT PRIMARY KEY,
  steam_id   TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (Commander volunteers are the "Commander Pool" Discord role, not a table.)

-- Who commanded what, for after-action and fairness later.
CREATE TABLE IF NOT EXISTS commander_log (
  id         BIGSERIAL PRIMARY KEY,
  match_id   BIGINT REFERENCES matches(id),
  faction    TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  event      TEXT NOT NULL,  -- offered | accepted | declined | timeout | standdown | removed | claimed
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post-match commander ratings. One round per commander per match.
CREATE TABLE IF NOT EXISTS rating_rounds (
  id           BIGSERIAL PRIMARY KEY,
  match_id     BIGINT NOT NULL REFERENCES matches(id),
  faction      TEXT NOT NULL,
  commander_id TEXT NOT NULL,
  served_sec   INTEGER NOT NULL,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at    TIMESTAMPTZ NOT NULL,
  notified     BOOLEAN NOT NULL DEFAULT false,   -- commander got their summary
  toxic_alerted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (match_id, faction, commander_id)
);

-- Who may vote in a round (played on that faction long enough).
CREATE TABLE IF NOT EXISTS rating_voters (
  round_id BIGINT NOT NULL REFERENCES rating_rounds(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  PRIMARY KEY (round_id, voter_id)
);

-- The votes. value: good | poor | toxic. One per voter per round, changeable until closes_at.
CREATE TABLE IF NOT EXISTS rating_votes (
  round_id BIGINT NOT NULL REFERENCES rating_rounds(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  value    TEXT NOT NULL CHECK (value IN ('good', 'poor', 'toxic')),
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, voter_id)
);
