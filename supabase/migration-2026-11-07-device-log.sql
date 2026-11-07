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
