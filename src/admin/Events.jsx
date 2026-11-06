import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useEvents } from '../lib/useEvents'
import { DatePicker } from '../components/DatePicker'
import { FormModal, ConfirmModal } from '../components/Modal'

const fmtDay = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export default function Events() {
  const ev = useEvents()
  const [name, setName] = useState(''); const [starts, setStarts] = useState(''); const [ends, setEnds] = useState('')
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  async function add(e) {
    e.preventDefault(); setErr('')
    const { data, error } = await supabase.from('events').insert({ name: name.trim(), starts_on: starts || null, ends_on: ends || null }).select().single()
    if (error) return setErr(error.message)
    setName(''); setStarts(''); setEnds(''); await ev.reload(); ev.setEventId(data.id)
  }
  async function toggleArchive(e) { await supabase.from('events').update({ archived: !e.archived }).eq('id', e.id); ev.reload() }
  async function save(v) {
    const { error } = await supabase.from('events').update({ name: v.name.trim(), starts_on: v.starts_on || null, ends_on: v.ends_on || null }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else ev.reload()
  }
  async function remove() {
    const e = deleting; setDeleting(null)
    const { error } = await supabase.from('events').delete().eq('id', e.id)
    if (error) setErr(error.code === '23503' ? `"${e.name}" has scan records, so it can't be deleted. Archive it instead.` : error.message); else { setErr(''); ev.reload() }
  }

  return (
    <div>
      <div className="page-head"><h1>Events</h1></div>
      {err && <div className="alert bad">{err}</div>}
      {editing && <FormModal title="Edit event" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'name', label: 'Event name', required: true, autoFocus: true }, { name: 'starts_on', label: 'Starts', type: 'date' }, { name: 'ends_on', label: 'Ends', type: 'date' }]} />}
      {deleting && <ConfirmModal title="Delete event" message={`Delete "${deleting.name}"? Cars and drivers in it are kept but lose their event. This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      <form className="card grid two" onSubmit={add}>
        <div style={{ gridColumn: '1/-1' }}><label>Event name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Yas Marina November 2026" required /></div>
        <div><label>Starts (optional)</label><DatePicker value={starts} onChange={setStarts} /></div>
        <div><label>Ends (optional)</label><DatePicker value={ends} onChange={setEnds} /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn-primary">Create event</button></div>
      </form>
      <div className="card">
        <p className="muted small">Operators' scans are recorded against the newest non-archived event. Archive an event when it's over.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Dates</th><th>Status</th><th></th></tr></thead>
          <tbody>{ev.events.map(e => (
            <tr key={e.id} style={{ opacity: e.archived ? .55 : 1 }}>
              <td><strong>{e.name}</strong></td>
              <td className="muted">{fmtDay(e.starts_on)}{e.ends_on ? ` → ${fmtDay(e.ends_on)}` : ''}</td>
              <td>{e.archived ? <span className="badge">Archived</span> : <span className="badge ok">Active</span>}</td>
              <td className="actions">
                <button className="btn-sm btn-ghost" onClick={() => setEditing(e)}>Edit</button>
                <button className="btn-sm btn-ghost" onClick={() => toggleArchive(e)}>{e.archived ? 'Unarchive' : 'Archive'}</button>
                <button className="btn-sm btn-danger" onClick={() => setDeleting(e)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
