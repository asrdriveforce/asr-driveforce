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

-- ---------- Grants (required when "Automatically expose new tables" is off) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update on tables to authenticated;

-- Safety net: create a profile for any auth user that lacks one
insert into profiles (id, full_name, role)
select u.id, coalesce(u.raw_user_meta_data->>'full_name',''), 'operator'
from auth.users u left join profiles p on p.id = u.id where p.id is null;

-- ---------- Delete (admin only; rows with scans are protected by foreign keys) ----------
grant delete on events, cars, drivers to authenticated;
alter default privileges in schema public grant delete on tables to authenticated;

-- ---------- Operator access restriction ----------
-- Operators no longer read the drivers table directly. They resolve a scanned code via this function,
-- which returns only what the scan screen needs. Admins keep full table access through RLS.
drop policy if exists drivers_read on drivers;
create policy drivers_read_admin on drivers for select using (is_admin());

create or replace function driver_by_code(p_code text)
returns table (id uuid, full_name text, code text)
language sql stable security definer set search_path = public as $$
  select d.id, d.full_name, d.code from drivers d where d.code = p_code and d.active and is_operator();
$$;
grant execute on function driver_by_code(text) to authenticated;

-- Operators may insert walk-ins but the insert policy alone is enough; they get the row back via driver_by_code.
-- Scans: operators only need to read their own scans (duplicate check-in guard); admins read all.
drop policy if exists scans_read on scans;
create policy scans_read_admin on scans for select using (is_admin());
drop policy if exists scans_read_own on scans;
create policy scans_read_own on scans for select using (operator_id = auth.uid());

-- Duplicate check-in guard needs to see other operators' check-ins too: expose only that fact.
create or replace function checkin_time_today(p_driver uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(scanned_at) from scans
  where kind = 'checkin' and driver_id = p_driver and not voided
    and scanned_at >= (date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')
    and is_operator();
$$;
grant execute on function checkin_time_today(uuid) to authenticated;

-- Views and lookup functions respect the caller's role
alter view assignment_history set (security_invoker = true);
create or replace function driver_in_car_at(p_plate text, p_at timestamptz)
returns table (
  car_id uuid, plate text, driver_id uuid, driver_name text,
  assigned_at timestamptz, ended_at timestamptz, operator_name text, scan_id uuid
)
language sql stable security definer set search_path = public as $$
  with c as (select id, plate from cars where upper(plate) = upper(p_plate) and is_admin() limit 1),
  a as (
    select s.* from scans s, c
    where s.car_id = c.id and s.kind = 'assign' and not s.voided and s.scanned_at <= p_at
    order by s.scanned_at desc limit 1
  ),
  p as (
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

-- ---------- Hard delete (admin) ----------
-- Deleting a car, driver or event removes its scan records too. Void remains the non-destructive option.
alter table scans drop constraint if exists scans_car_id_fkey, add constraint scans_car_id_fkey foreign key (car_id) references cars(id) on delete cascade;
alter table scans drop constraint if exists scans_driver_id_fkey, add constraint scans_driver_id_fkey foreign key (driver_id) references drivers(id) on delete cascade;
alter table scans drop constraint if exists scans_event_id_fkey, add constraint scans_event_id_fkey foreign key (event_id) references events(id) on delete cascade;
grant delete on scans to authenticated;
drop policy if exists scans_admin_delete on scans;
create policy scans_admin_delete on scans for delete using (is_admin());
-- Equipment: items with numbered slots (e.g. a radio charging block with 6 radios),
-- issued to a person by scanning item then badge, returned by scanning item and ticking slots.
-- Run once in Supabase SQL Editor.

create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  name text not null,
  slots int not null default 1 check (slots between 1 and 50),
  code text not null unique default encode(gen_random_bytes(6),'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists equipment_events (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  kind text not null check (kind in ('issue','return')),
  driver_id uuid references drivers(id) on delete cascade,   -- holder (issue) ; optional on return
  slots int[] not null default '{}',                          -- slots returned (return events)
  operator_id uuid references profiles(id),
  event_id uuid references events(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  client_id text unique,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists equipment_events_item_idx on equipment_events (equipment_id, scanned_at desc);

alter table equipment enable row level security;
alter table equipment_events enable row level security;

drop policy if exists equipment_admin on equipment;
create policy equipment_admin on equipment for all using (is_admin()) with check (is_admin());
drop policy if exists equipment_events_admin on equipment_events;
create policy equipment_events_admin on equipment_events for all using (is_admin()) with check (is_admin());
drop policy if exists equipment_events_insert on equipment_events;
create policy equipment_events_insert on equipment_events for insert with check (is_operator() and operator_id = auth.uid());
drop policy if exists equipment_events_read_own on equipment_events;
create policy equipment_events_read_own on equipment_events for select using (operator_id = auth.uid());

grant select, insert, update, delete on equipment, equipment_events to authenticated;

-- Current state of one or all items: holder, issued time, returned and missing slots since the last issue.
create or replace function equipment_status(p_equipment uuid default null)
returns table (
  id uuid, name text, slots int, code text, active boolean, event_id uuid,
  holder_id uuid, holder_name text, issued_at timestamptz, issued_by text,
  returned_slots int[], missing_slots int[], last_return_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with items as (
    select * from equipment e where (p_equipment is null or e.id = p_equipment) and is_operator()
  ),
  last_issue as (
    select distinct on (ev.equipment_id) ev.equipment_id, ev.driver_id, ev.scanned_at, ev.operator_id
    from equipment_events ev join items i on i.id = ev.equipment_id
    where ev.kind = 'issue'
    order by ev.equipment_id, ev.scanned_at desc
  ),
  rets as (
    select ev.equipment_id,
           array_agg(distinct s order by s) filter (where s is not null) as returned,
           max(ev.scanned_at) as last_return_at
    from equipment_events ev
    join last_issue li on li.equipment_id = ev.equipment_id and ev.scanned_at > li.scanned_at
    left join lateral unnest(ev.slots) as s on true
    where ev.kind = 'return'
    group by ev.equipment_id
  )
  select i.id, i.name, i.slots, i.code, i.active, i.event_id,
         li.driver_id, d.full_name, li.scanned_at, pr.full_name,
         coalesce(r.returned, '{}'),
         case when li.equipment_id is null then '{}'::int[]
              else (select coalesce(array_agg(n order by n), '{}') from generate_series(1, i.slots) n where not (n = any(coalesce(r.returned, '{}')))) end,
         r.last_return_at
  from items i
  left join last_issue li on li.equipment_id = i.id
  left join rets r on r.equipment_id = i.id
  left join drivers d on d.id = li.driver_id
  left join profiles pr on pr.id = li.operator_id
  order by i.name;
$$;
grant execute on function equipment_status(uuid) to authenticated;

-- Operators resolve a scanned equipment code to what the scan screen needs
create or replace function equipment_by_code(p_code text)
returns table (id uuid, name text, slots int, holder_name text, issued_at timestamptz, missing_slots int[])
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.slots, s.holder_name, s.issued_at, s.missing_slots
  from equipment e, lateral equipment_status(e.id) s
  where e.code = p_code and e.active and is_operator();
$$;
grant execute on function equipment_by_code(text) to authenticated;
-- "All equipment back": one scan marks every outstanding unit of every item as returned.
create or replace function return_all_equipment(p_event uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not is_operator() then raise exception 'not allowed'; end if;
  for r in select * from equipment_status() where array_length(missing_slots, 1) > 0 loop
    insert into equipment_events (equipment_id, kind, slots, operator_id, event_id, note)
    values (r.id, 'return', r.missing_slots, auth.uid(), coalesce(p_event, r.event_id), 'All equipment back');
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function return_all_equipment(uuid) to authenticated;
-- Live events, event inferred from the scanned item, operator assignment per event.
-- Run once in Supabase SQL Editor.

alter table events add column if not exists live boolean not null default false;

create table if not exists event_operators (
  event_id uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
alter table event_operators enable row level security;
drop policy if exists event_operators_admin on event_operators;
create policy event_operators_admin on event_operators for all using (is_admin()) with check (is_admin());
drop policy if exists event_operators_own on event_operators;
create policy event_operators_own on event_operators for select using (profile_id = auth.uid());
grant select, insert, delete on event_operators to authenticated;

-- May the current user record scans for this event? The event must be live (and not past its end date);
-- admins always, operators only if assigned to it.
create or replace function can_scan(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = p_event and e.live and not e.archived
                 and (e.ends_on is null or (now() at time zone 'Asia/Dubai')::date <= e.ends_on))
     and (is_admin() or exists (select 1 from event_operators eo where eo.event_id = p_event and eo.profile_id = auth.uid()));
$$;
grant execute on function can_scan(uuid) to authenticated;

-- The event is taken from the scanned car / driver / equipment, never from the phone.
create or replace function scan_event_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev uuid;
begin
  if new.kind = 'park_all' then
    -- park all applies to every live event the operator may scan for; file under the first such event
    select e.id into ev from events e where can_scan(e.id) order by e.created_at desc limit 1;
  elsif new.car_id is not null then
    select event_id into ev from cars where id = new.car_id;
  elsif new.driver_id is not null then
    select event_id into ev from drivers where id = new.driver_id;
  end if;
  if ev is null then raise exception 'NO_EVENT: this item is not linked to an event'; end if;
  if not can_scan(ev) then raise exception 'NOT_LIVE: event is not live or you are not assigned to it'; end if;
  new.event_id := ev;
  return new;
end $$;
drop trigger if exists scans_set_event on scans;
create trigger scans_set_event before insert on scans for each row execute function scan_event_id();

create or replace function equipment_event_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev uuid;
begin
  select event_id into ev from equipment where id = new.equipment_id;
  if ev is null then raise exception 'NO_EVENT: this item is not linked to an event'; end if;
  if not can_scan(ev) then raise exception 'NOT_LIVE: event is not live or you are not assigned to it'; end if;
  new.event_id := ev;
  return new;
end $$;
drop trigger if exists equipment_events_set_event on equipment_events;
create trigger equipment_events_set_event before insert on equipment_events for each row execute function equipment_event_id();

-- Park all: end assignments only in events the operator may scan for
create or replace function park_all_live() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not is_operator() then raise exception 'not allowed'; end if;
  for r in select e.id from events e where can_scan(e.id) loop
    insert into scans (kind, operator_id, event_id) values ('park_all', auth.uid(), r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function park_all_live() to authenticated;

-- park_all rows are now scoped to one event each
create or replace function driver_in_car_at(p_plate text, p_at timestamptz)
returns table (
  car_id uuid, plate text, driver_id uuid, driver_name text,
  assigned_at timestamptz, ended_at timestamptz, operator_name text, scan_id uuid
)
language sql stable security definer set search_path = public as $$
  with c as (select id, plate, event_id from cars where upper(plate) = upper(p_plate) and is_admin() limit 1),
  a as (
    select s.* from scans s, c
    where s.car_id = c.id and s.kind = 'assign' and not s.voided and s.scanned_at <= p_at
    order by s.scanned_at desc limit 1
  ),
  p as (
    select min(s.scanned_at) as ended_at from scans s, a, c
    where not s.voided and s.scanned_at > a.scanned_at
      and ((s.kind = 'park_all' and s.event_id = c.event_id)
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
      and ((e.kind = 'park_all' and e.event_id = c.event_id)
           or (e.kind = 'park_car' and e.car_id = s.car_id)
           or (e.kind = 'assign' and e.car_id = s.car_id))
  ) as ended_at,
  s.voided, s.void_reason
from scans s
join cars c on c.id = s.car_id
left join drivers d on d.id = s.driver_id
left join profiles pr on pr.id = s.operator_id
where s.kind = 'assign';
alter view assignment_history set (security_invoker = true);

-- What the scan screen shows: the live events this user may scan for
create or replace function my_live_events()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name from events e where can_scan(e.id) order by e.name;
$$;
grant execute on function my_live_events() to authenticated;

-- Equipment "return all" limited to events the operator may scan for
create or replace function return_all_equipment(p_event uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not is_operator() then raise exception 'not allowed'; end if;
  for r in select * from equipment_status() where array_length(missing_slots, 1) > 0 and can_scan(event_id) and (p_event is null or event_id = p_event) loop
    insert into equipment_events (equipment_id, kind, slots, operator_id, note)
    values (r.id, 'return', r.missing_slots, auth.uid(), 'All equipment back');
    n := n + 1;
  end loop;
  return n;
end $$;
-- Devices: the phones operators carry. Colour, model, SIM number, who holds it.
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  colour text not null,                 -- e.g. Red, Blue, Green (the sticker on the phone)
  model text not null default '',
  phone text not null default '',       -- SIM number
  notes text not null default '',
  assigned_to uuid references profiles(id) on delete set null,
  assigned_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table devices enable row level security;
drop policy if exists devices_admin on devices;
create policy devices_admin on devices for all using (is_admin()) with check (is_admin());
drop policy if exists devices_own on devices;
create policy devices_own on devices for select using (assigned_to = auth.uid());
grant select, insert, update, delete on devices to authenticated;

-- Operators view now carries the device they hold
create or replace view operators as
select p.id, p.full_name, p.role, p.active, u.email, p.created_at,
       d.id as device_id, d.colour as device_colour, d.phone as device_phone, d.model as device_model
from profiles p
join auth.users u on u.id = p.id
left join devices d on d.assigned_to = p.id and d.active
where is_admin() or p.id = auth.uid();
-- Device hand-out / hand-back log
create table if not exists device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  kind text not null check (kind in ('out','back')),
  profile_id uuid references profiles(id) on delete set null,   -- who received it (out) / who returned it (back)
  by_id uuid references profiles(id) on delete set null,        -- admin who logged it
  at timestamptz not null default now()
);
alter table device_events enable row level security;
drop policy if exists device_events_admin on device_events;
create policy device_events_admin on device_events for all using (is_admin()) with check (is_admin());
grant select, insert, delete on device_events to authenticated;
