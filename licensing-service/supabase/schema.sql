create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  status text not null default 'UNUSED' check (status in ('UNUSED', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  plan text not null default 'STANDARD',
  store_mode_allowed text not null default 'ANY' check (store_mode_allowed in ('ANY', 'SUPERMARKET', 'GADGET')),
  device_fingerprint_hash text unique,
  activated_device_name text,
  issued_to_name text,
  issued_to_email text,
  store_name text,
  store_mode text check (store_mode in ('SUPERMARKET', 'GADGET')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  validation_interval_days integer not null default 0 check (validation_interval_days >= 0),
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  activated_at timestamptz,
  last_validated_at timestamptz,
  validation_due_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists licenses_status_idx on public.licenses (status);
create index if not exists licenses_validation_due_idx on public.licenses (validation_due_at);
create index if not exists licenses_expires_at_idx on public.licenses (expires_at);

create table if not exists public.license_events (
  id bigint generated always as identity primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists license_events_license_id_idx on public.license_events (license_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

 drop trigger if exists trg_licenses_updated_at on public.licenses;
create trigger trg_licenses_updated_at
before update on public.licenses
for each row
execute function public.set_updated_at();

comment on table public.licenses is 'GoodyPOS licensing records. One license key should bind to one device only.';
comment on table public.license_events is 'Audit log for activation, validation, revocation, and device resets.';
