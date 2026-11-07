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
