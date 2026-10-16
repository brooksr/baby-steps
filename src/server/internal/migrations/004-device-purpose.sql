ALTER TABLE device_grants ADD COLUMN purpose TEXT NOT NULL DEFAULT 'phone' CHECK(purpose IN ('phone','watch','nursery'));
