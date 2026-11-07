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
