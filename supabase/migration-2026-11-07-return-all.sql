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
