-- Internal backend v1. Not the Dexie database or a mirror of a Google Sheet.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  disabled_at TEXT
) STRICT;

-- The provider subject is a verified OIDC sub / stable passkey user handle.
-- Email is display/contact data elsewhere, never an account-linking key.
CREATE TABLE identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'passkey')),
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
) STRICT;

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL CHECK (sign_count >= 0),
  transports_json TEXT NOT NULL CHECK (json_valid(transports_json)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

-- Store token digests, never raw session or refresh tokens.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  legacy_sheet_id TEXT UNIQUE
) STRICT;

-- Retain the original JSON fields/ids. family_id is the isolation boundary.
CREATE TABLE profiles (
  family_id TEXT NOT NULL REFERENCES families(id),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (family_id, id),
  CHECK (json_extract(payload, '$.id') IS id AND json_extract(payload, '$.familyId') IS family_id)
) STRICT;
CREATE TRIGGER profiles_archive_only BEFORE DELETE ON profiles
BEGIN
  SELECT RAISE(ABORT, 'Profiles are archived, never deleted');
END;

CREATE TABLE memberships (
  family_id TEXT NOT NULL REFERENCES families(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  profile_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'caregiver')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (family_id, account_id),
  UNIQUE (family_id, profile_id),
  FOREIGN KEY (family_id, profile_id) REFERENCES profiles(family_id, id)
) STRICT;

-- Tombstones are needed to sync event/list deletion to offline clients.
-- Profiles are archived in their own table, never deleted through this path.
CREATE TABLE records (
  family_id TEXT NOT NULL REFERENCES families(id),
  collection TEXT NOT NULL CHECK (collection IN ('events', 'shopping', 'tasks', 'nursery')),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  revision INTEGER NOT NULL CHECK (revision > 0),
  deleted_at TEXT,
  PRIMARY KEY (family_id, collection, id)
) STRICT;

-- Append in the same transaction as the write. Sequence is an opaque cursor.
CREATE TABLE changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL REFERENCES families(id),
  collection TEXT NOT NULL CHECK (collection IN ('profiles', 'events', 'shopping', 'tasks', 'nursery')),
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  deleted_at TEXT
) STRICT;
CREATE INDEX changes_family_sequence ON changes(family_id, sequence);

-- Deduplicate across retries within a family; reject changed request hashes.
CREATE TABLE operations (
  family_id TEXT NOT NULL REFERENCES families(id),
  operation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (family_id, operation_id)
) STRICT;
