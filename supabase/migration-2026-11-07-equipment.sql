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
