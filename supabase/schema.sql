-- ASR DriveForce schema
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ---------- Roles / profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'operator' check (role in ('admin','operator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a user is created in auth
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''),
          coalesce(new.raw_user_meta_data->>'role','operator'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- ---------- Core tables ----------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date,
  ends_on date,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists cars (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  plate text not null,
  label text not null default '',
  code text not null unique default encode(gen_random_bytes(6),'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cars_plate_idx on cars (upper(plate));

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  full_name text not null,
  phone text not null default '',
  email text not null default '',
  code text not null unique default encode(gen_random_bytes(6),'hex'),
  walk_in boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists drivers_name_idx on drivers (lower(full_name));

-- Every scan is an immutable log row. Corrections are voids, never deletes.
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('assign','checkin','park_car','park_all')),
  car_id uuid references cars(id),
  driver_id uuid references drivers(id),
  event_id uuid references events(id),
  operator_id uuid references profiles(id),
  scanned_at timestamptz not null default now(),
  client_id text unique,           -- idempotency key from the phone's retry queue
  voided boolean not null default false,
  voided_by uuid references profiles(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists scans_car_time_idx on scans (car_id, scanned_at desc);
create index if not exists scans_driver_time_idx on scans (driver_id, scanned_at desc);
create index if not exists scans_time_idx on scans (scanned_at desc);

-- ---------- Who was in car X at time T ----------
-- Rule: the latest non-void 'assign' for that car at or before T,
-- unless a park_car for that car or a park_all occurred after that assign and at or before T.
create or replace function driver_in_car_at(p_plate text, p_at timestamptz)
returns table (
  car_id uuid, plate text, driver_id uuid, driver_name text,
  assigned_at timestamptz, ended_at timestamptz, operator_name text, scan_id uuid
)
language sql stable security definer set search_path = public as $$
  with c as (select id, plate from cars where upper(plate) = upper(p_plate) limit 1),
  a as (
    select s.* from scans s, c
    where s.car_id = c.id and s.kind = 'assign' and not s.voided and s.scanned_at <= p_at
    order by s.scanned_at desc limit 1
  ),
  p as (
    -- when that assignment actually ended (park, or the next driver in the same car), if ever
    select min(s.scanned_at) as ended_at from scans s, a
    where not s.voided and s.scanned_at > a.scanned_at
      and (s.kind = 'park_all'
           or (s.kind = 'park_car' and s.car_id = a.car_id)
           or (s.kind = 'assign' and s.car_id = a.car_id))
  )
  select c.id, c.plate, a.driver_id, d.full_name, a.scanned_at, p.ended_at, pr.full_name, a.id
  from c
  left join a on true
  left join p on true
  left join drivers d on d.id = a.driver_id
  left join profiles pr on pr.id = a.operator_id
  where a.id is not null and (p.ended_at is null or p.ended_at > p_at);
$$;

-- Full history view: each assign with its computed end time
create or replace view assignment_history as
select
  s.id as scan_id,
  s.car_id, c.plate,
  s.driver_id, d.full_name as driver_name,
  s.operator_id, pr.full_name as operator_name,
  s.event_id,
  s.scanned_at as assigned_at,
  (
    select min(e.scanned_at) from scans e
    where not e.voided and e.scanned_at > s.scanned_at
      and (e.kind = 'park_all'
           or (e.kind = 'park_car' and e.car_id = s.car_id)
           or (e.kind = 'assign' and e.car_id = s.car_id))
  ) as ended_at,
  s.voided, s.void_reason
from scans s
join cars c on c.id = s.car_id
left join drivers d on d.id = s.driver_id
left join profiles pr on pr.id = s.operator_id
where s.kind = 'assign';

-- ---------- Row level security ----------
alter table profiles enable row level security;
alter table events enable row level security;
alter table cars enable row level security;
alter table drivers enable row level security;
alter table scans enable row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (is_operator());
drop policy if exists profiles_admin on profiles;
create policy profiles_admin on profiles for all using (is_admin()) with check (is_admin());

drop policy if exists events_read on events;
create policy events_read on events for select using (is_operator());
drop policy if exists events_admin on events;
create policy events_admin on events for all using (is_admin()) with check (is_admin());

drop policy if exists cars_read on cars;
create policy cars_read on cars for select using (is_operator());
drop policy if exists cars_admin on cars;
create policy cars_admin on cars for all using (is_admin()) with check (is_admin());

drop policy if exists drivers_read on drivers;
create policy drivers_read on drivers for select using (is_operator());
drop policy if exists drivers_insert_operator on drivers;
create policy drivers_insert_operator on drivers for insert with check (is_operator());
drop policy if exists drivers_admin on drivers;
create policy drivers_admin on drivers for all using (is_admin()) with check (is_admin());

drop policy if exists scans_read on scans;
create policy scans_read on scans for select using (is_operator());
drop policy if exists scans_insert on scans;
create policy scans_insert on scans for insert with check (is_operator() and operator_id = auth.uid());
drop policy if exists scans_admin_update on scans;
create policy scans_admin_update on scans for update using (is_admin()) with check (is_admin());

-- Public driver page: look up a driver by code without login (returns name + code only)
create or replace function public_driver(p_code text)
returns table (full_name text, code text, event_name text)
language sql stable security definer set search_path = public as $$
  select d.full_name, d.code, e.name from drivers d left join events e on e.id = d.event_id
  where d.code = p_code and d.active;
$$;
grant execute on function public_driver(text) to anon, authenticated;
grant execute on function driver_in_car_at(text, timestamptz) to authenticated;
grant select on assignment_history to authenticated;

-- ---------- Admin: list auth users with email (for operator management) ----------
create or replace view operators as
select p.id, p.full_name, p.role, p.active, u.email, p.created_at
from profiles p join auth.users u on u.id = p.id
where is_admin() or p.id = auth.uid();
grant select on operators to authenticated;
