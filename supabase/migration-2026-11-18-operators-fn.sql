-- Replace the operators view (flagged by Supabase advisor: references auth.users) with a function
-- that returns the same rows, admin-only (plus the caller's own row), never exposed to anon.
drop view if exists operators;

create or replace function list_operators()
returns table (
  id uuid, full_name text, role text, active boolean, email text, created_at timestamptz,
  device_id uuid, device_colour text, device_phone text, device_model text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.active, u.email::text, p.created_at,
         d.id, d.colour, d.phone, d.model
  from profiles p
  join auth.users u on u.id = p.id
  left join devices d on d.assigned_to = p.id and d.active
  where is_admin() or p.id = auth.uid()
  order by p.full_name;
$$;
revoke all on function list_operators() from public, anon;
grant execute on function list_operators() to authenticated;

-- Belt and braces: anon has no business reading any table directly
revoke all on all tables in schema public from anon;
