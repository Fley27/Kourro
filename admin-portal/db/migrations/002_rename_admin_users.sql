-- Rename adm_admins → admin_users (matches the platform spec: a table called
-- "admin users"). 001 already creates admin_users on fresh installs, so this
-- only does work on databases that were migrated before the rename.
-- Foreign keys in other adm_* tables follow the table automatically (they
-- reference it by OID, not by name).
do $$
begin
  if to_regclass('public.adm_admins') is not null
     and to_regclass('public.admin_users') is null then
    alter table adm_admins rename to admin_users;
    alter index idx_adm_admins_role rename to idx_admin_users_role;
    alter trigger trg_adm_admins_updated on admin_users
      rename to trg_admin_users_updated;
  end if;

  -- Constraint names Postgres does not rename automatically. Both blocks are
  -- no-ops on fresh databases (001 already creates admin_users with correct
  -- names) and on databases where the rename already ran.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_pkey'
  ) then
    alter table admin_users rename constraint adm_admins_pkey to admin_users_pkey;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_user_id_key'
  ) then
    alter table admin_users rename constraint adm_admins_user_id_key to admin_users_user_id_key;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_email_key'
  ) then
    alter table admin_users rename constraint adm_admins_email_key to admin_users_email_key;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_created_by_fkey'
  ) then
    alter table admin_users rename constraint adm_admins_created_by_fkey to admin_users_created_by_fkey;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_role_check'
  ) then
    alter table admin_users rename constraint adm_admins_role_check to admin_users_role_check;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'admin_users'::regclass and conname = 'adm_admins_status_check'
  ) then
    alter table admin_users rename constraint adm_admins_status_check to admin_users_status_check;
  end if;
end $$;
