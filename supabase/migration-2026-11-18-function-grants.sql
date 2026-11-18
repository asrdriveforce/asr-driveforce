-- Tighten function privileges (Supabase security advisor).
-- Postgres grants EXECUTE to PUBLIC on new functions by default; undo that for ours and for future ones.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;

-- The driver's personal code page is opened without login; this one stays callable by anon
grant execute on function public_driver(text) to anon, authenticated;

-- Trigger functions are never called directly
revoke all on function handle_new_user() from authenticated;
revoke all on function scan_event_id() from authenticated;
revoke all on function equipment_event_id() from authenticated;

-- Everything else: signed-in users only (already granted; restated for clarity)
grant execute on function is_admin() to authenticated;
grant execute on function is_operator() to authenticated;
grant execute on function can_scan(uuid) to authenticated;
grant execute on function driver_in_car_at(text, timestamptz) to authenticated;
grant execute on function driver_by_code(text) to authenticated;
grant execute on function checkin_time_today(uuid) to authenticated;
grant execute on function my_live_events() to authenticated;
grant execute on function park_all_live() to authenticated;
grant execute on function equipment_status(uuid) to authenticated;
grant execute on function equipment_by_code(text) to authenticated;
grant execute on function return_all_equipment(uuid) to authenticated;
grant execute on function list_operators() to authenticated;
