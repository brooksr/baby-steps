CREATE TABLE native_installations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  capabilities_json TEXT NOT NULL CHECK(json_valid(capabilities_json)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE TABLE native_refresh (
  token_hash TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES native_installations(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
) STRICT;
CREATE TABLE native_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  installation_id TEXT NOT NULL REFERENCES native_installations(id)
) STRICT;
