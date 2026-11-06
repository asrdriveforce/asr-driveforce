import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useEvents } from '../lib/useEvents'

export default function Events() {
  const ev = useEvents()
  const [name, setName] = useState(''); const [starts, setStarts] = useState(''); const [ends, setEnds] = useState('')
  const [err, setErr] = useState('')

  async function add(e) {
    e.preventDefault(); setErr('')
    const { data, error } = await supabase.from('events').insert({ name: name.trim(), starts_on: starts || null, ends_on: ends || null }).select().single()
    if (error) return setErr(error.message)
    setName(''); setStarts(''); setEnds(''); await ev.reload(); ev.setEventId(data.id)
  }
  async function toggleArchive(e) {
    await supabase.from('events').update({ archived: !e.archived }).eq('id', e.id); ev.reload()
  }
  async function rename(e) {
    const n = window.prompt('Event name', e.name); if (!n || n === e.name) return
    await supabase.from('events').update({ name: n }).eq('id', e.id); ev.reload()
  }

  return (
    <div>
      <h1>Events</h1>
      <form className="card grid two" onSubmit={add}>
        {err && <div className="alert bad" style={{ gridColumn: '1/-1' }}>{err}</div>}
        <div style={{ gridColumn: '1/-1' }}><label>Event name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Yas Marina November 2026" required /></div>
        <div><label>Starts (optional)</label><input type="date" value={starts} onChange={e => setStarts(e.target.value)} /></div>
        <div><label>Ends (optional)</label><input type="date" value={ends} onChange={e => setEnds(e.target.value)} /></div>
        <div><button className="btn-primary">Create event</button></div>
      </form>
      <div className="card">
        <p className="muted small">The newest non-archived event is the one operators' scans are recorded against. Archive an event when it's over.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Dates</th><th>Status</th><th></th></tr></thead>
          <tbody>{ev.events.map(e => (
            <tr key={e.id} style={{ opacity: e.archived ? .5 : 1 }}>
              <td><strong>{e.name}</strong></td>
              <td className="muted">{e.starts_on || ''}{e.ends_on ? ` → ${e.ends_on}` : ''}</td>
              <td>{e.archived ? <span className="badge">Archived</span> : <span className="badge ok">Active</span>}</td>
              <td className="row"><button className="btn-sm btn-ghost" onClick={() => rename(e)}>Rename</button><button className="btn-sm btn-ghost" onClick={() => toggleArchive(e)}>{e.archived ? 'Unarchive' : 'Archive'}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
