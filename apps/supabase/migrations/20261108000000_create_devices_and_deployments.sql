-- Raspberry Pis the control center can reach over SSH, and the history of
-- deploys to them. The web app talks to these tables through Drizzle as the
-- postgres role; row level security is on with no policies so the public
-- Supabase API (anon / authenticated keys) can never read device secrets.
create table if not exists public.devices (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  host text not null,
  port integer not null default 22,
  username text not null default 'pi',
  auth_method text not null default 'password' check (auth_method in ('password', 'key')),
  -- AES-256-GCM ciphertext of the password or private key, see apps/web/src/lib/pi/crypto.ts.
  secret_encrypted text not null,
  remote_path text not null default 'raspberry-pi-script',
  gpio_pins integer[] not null default '{6}',
  created_at timestamp with time zone not null default now(),
  constraint devices_pkey primary key (id)
);

create index if not exists devices_owner_id_idx on public.devices (owner_id);

create table if not exists public.deployments (
  id serial not null,
  device_id uuid not null references public.devices (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone null,
  output text not null default '',
  triggered_by text null,
  constraint deployments_pkey primary key (id)
);

create index if not exists deployments_device_id_idx on public.deployments (device_id, started_at desc);

alter table public.devices enable row level security;
alter table public.deployments enable row level security;
