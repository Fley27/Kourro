-- 027: emergency contact rides the profiles row so it syncs like any other
-- roster data. The device keeps the composite on employees.emergency_json;
-- the cloud stores flat text columns (queryable, LWW-arbitrated with the row).
alter table profiles add column if not exists emergency_name text;
alter table profiles add column if not exists emergency_phone text;
alter table profiles add column if not exists emergency_address text;
