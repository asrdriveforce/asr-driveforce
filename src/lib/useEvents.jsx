import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Event list plus a selected event id that persists across admin pages.
export function useEvents() {
  const [events, setEvents] = useState([])
  const [eventId, setEventIdState] = useState(() => { try { return localStorage.getItem('df_event') || '' } catch { return '' } })
  const [loaded, setLoaded] = useState(false)

  async function reload() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending: false })
    setEvents(data || []); setLoaded(true)
    if (!data?.length) { if (eventId) setEventId('') }
    else if (!data.find(e => e.id === eventId)) {
      const first = data.find(e => !e.archived) || data[0]
      setEventId(first.id)
    }
  }
  function setEventId(id) { setEventIdState(id); try { localStorage.setItem('df_event', id) } catch { /* ignore */ } }
  useEffect(() => { reload() }, []) // eslint-disable-line

  const event = events.find(e => e.id === eventId) || null
  return { events, event, eventId, setEventId, reload, loaded }
}

export function EventPicker({ events, eventId, setEventId, allowAll }) {
  return (
    <select className="select-inline" value={eventId} onChange={e => setEventId(e.target.value)}>
      {allowAll && <option value="">All events</option>}
      {events.map(e => <option key={e.id} value={e.id}>{e.name}{e.archived ? ' (archived)' : ''}</option>)}
    </select>
  )
}
