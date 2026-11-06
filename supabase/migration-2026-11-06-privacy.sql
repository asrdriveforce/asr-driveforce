-- Run once in Supabase SQL Editor (operator access restriction, role-aware lookups, admin hard delete)

-- Operators no longer read the drivers table; they resolve a scanned code via a function
drop policy if exists drivers_read on drivers;
drop policy if exists drivers_read_admin on drivers;
create policy drivers_read_admin on drivers for select using (is_admin());

create or replace function driver_by_code(p_code text)
returns table (id uuid, full_name text, code text)
language sql stable security definer set search_path = public as $$
  select d.id, d.full_name, d.code from drivers d where d.code = p_code and d.active and is_operator();
$$;
grant execute on function driver_by_code(text) to authenticated;

-- Operators read only their own scans; admins read all
drop policy if exists scans_read on scans;
drop policy if exists scans_read_admin on scans;
create policy scans_read_admin on scans for select using (is_admin());
drop policy if exists scans_read_own on scans;
create policy scans_read_own on scans for select using (operator_id = auth.uid());

create or replace function checkin_time_today(p_driver uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(scanned_at) from scans
  where kind = 'checkin' and driver_id = p_driver and not voided
    and scanned_at >= (date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')
    and is_operator();
$$;
grant execute on function checkin_time_today(uuid) to authenticated;

-- Views and lookups respect the caller's role
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

-- Admin hard delete: removing a car, driver or event removes its scan records too
alter table scans drop constraint if exists scans_car_id_fkey, add constraint scans_car_id_fkey foreign key (car_id) references cars(id) on delete cascade;
alter table scans drop constraint if exists scans_driver_id_fkey, add constraint scans_driver_id_fkey foreign key (driver_id) references drivers(id) on delete cascade;
alter table scans drop constraint if exists scans_event_id_fkey, add constraint scans_event_id_fkey foreign key (event_id) references events(id) on delete cascade;
grant delete on scans to authenticated;
drop policy if exists scans_admin_delete on scans;
create policy scans_admin_delete on scans for delete using (is_admin());
