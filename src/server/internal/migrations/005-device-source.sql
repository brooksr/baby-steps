ALTER TABLE device_grants ADD COLUMN source_device_id TEXT;
ALTER TABLE native_installations ADD COLUMN source_device_id TEXT;
UPDATE native_installations SET source_device_id = id WHERE source_device_id IS NULL;
CREATE INDEX native_device_source ON native_installations(family_id, source_device_id);
