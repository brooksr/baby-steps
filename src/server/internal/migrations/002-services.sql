-- Forward-only migration: v1 remains byte-for-byte unchanged.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_id TEXT,
  challenge TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;
CREATE TABLE recovery_codes (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  PRIMARY KEY (account_id, code_hash)
) STRICT;
CREATE TABLE session_details (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  csrf_hash TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  authenticated_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('browser', 'native'))
) STRICT;
CREATE TABLE invitations (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  profile_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent','caregiver')),
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES accounts(id),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  FOREIGN KEY (family_id, profile_id) REFERENCES profiles(family_id, id)
) STRICT;
CREATE TABLE device_grants (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  user_code_hash TEXT NOT NULL UNIQUE,
  family_id TEXT REFERENCES families(id),
  account_id TEXT REFERENCES accounts(id),
  session_id TEXT REFERENCES sessions(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;
CREATE TABLE audit_log (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES accounts(id),
  family_id TEXT REFERENCES families(id),
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE sync_retention (
  family_id TEXT PRIMARY KEY REFERENCES families(id),
  floor INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE migration_receipts (
  source_digest TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  imported_at TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json))
) STRICT;
CREATE TABLE rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;
