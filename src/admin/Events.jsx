import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useEvents } from '../lib/useEvents'
import { DatePicker } from '../components/DatePicker'
import { FormModal, ConfirmModal } from '../components/Modal'
import { ColourDot } from './Devices'

const fmtDay = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const todayDubai = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

export default function Events() {
  const ev = useEvents()
  const [name, setName] = useState(''); const [starts, setStarts] = useState(''); const [ends, setEnds] = useState('')
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [ops, setOps] = useState([])            // operator accounts (non-admin, active)
  const [assigned, setAssigned] = useState({})  // eventId -> Set(profileId)
  const [showOps, setShowOps] = useState(null)  // event whose operator list is open

  async function loadOps() {
    const [{ data: o }, { data: a }] = await Promise.all([
      supabase.from('operators').select('id,full_name,email,role,active,device_colour,device_phone').order('full_name'),
      supabase.from('event_operators').select('event_id,profile_id'),
    ])
    setOps((o || []).filter(x => x.active && x.role !== 'admin'))
    const m = {}; for (const r of a || []) (m[r.event_id] ||= new Set()).add(r.profile_id)
    setAssigned(m)
  }
  useEffect(() => { loadOps() }, [])

  async function add(e) {
    e.preventDefault(); setErr('')
    const { data, error } = await supabase.from('events').insert({ name: name.trim(), starts_on: starts || null, ends_on: ends || null }).select().single()
    if (error) return setErr(error.message)
    setName(''); setStarts(''); setEnds(''); await ev.reload(); ev.setEventId(data.id)
  }
  async function toggleArchive(e) { await supabase.from('events').update({ archived: !e.archived, live: false }).eq('id', e.id); ev.reload() }
  async function setLive(e, live) {
    const { error } = await supabase.from('events').update({ live }).eq('id', e.id)
    if (error) setErr(error.message); else ev.reload()
  }
  async function toggleOp(e, profileId) {
    const has = assigned[e.id]?.has(profileId)
    const { error } = has
      ? await supabase.from('event_operators').delete().eq('event_id', e.id).eq('profile_id', profileId)
      : await supabase.from('event_operators').insert({ event_id: e.id, profile_id: profileId })
    if (error) setErr(error.message); else loadOps()
  }
  async function save(v) {
    const { error } = await supabase.from('events').update({ name: v.name.trim(), starts_on: v.starts_on || null, ends_on: v.ends_on || null }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else ev.reload()
  }
  async function askDelete(e) {
    const { count } = await supabase.from('scans').select('id', { count: 'exact', head: true }).eq('event_id', e.id)
    setDeleting({ ...e, scanCount: count || 0 })
  }
  async function remove() {
    const e = deleting; setDeleting(null)
    const { error } = await supabase.from('events').delete().eq('id', e.id)
    if (error) setErr(error.message); else { setErr(''); ev.reload() }
  }

  return (
    <div>
      <div className="page-head"><h1>Events</h1></div>
      {err && <div className="alert bad">{err}</div>}
      {editing && <FormModal title="Edit event" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'name', label: 'Event name', required: true, autoFocus: true }, { name: 'starts_on', label: 'Starts', type: 'date' }, { name: 'ends_on', label: 'Ends', type: 'date' }]} />}
      {deleting && <ConfirmModal title="Delete event" message={`Delete "${deleting.name}"?${deleting.scanCount ? ` This also deletes its ${deleting.scanCount} scan record${deleting.scanCount === 1 ? '' : 's'}.` : ''} Cars and drivers in it are kept. This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      <form className="card grid two" onSubmit={add}>
        <div style={{ gridColumn: '1/-1' }}><label>Event name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Yas Marina November 2026" required /></div>
        <div><label>Starts (optional)</label><DatePicker value={starts} onChange={setStarts} /></div>
        <div><label>Ends (optional)</label><DatePicker value={ends} onChange={setEnds} /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn-primary">Create event</button></div>
      </form>
      <div className="card">
        <p className="muted small">Scans are accepted only for live events, from operators assigned to them (admins can always scan). The event is taken from the car, badge or item scanned. An event stops accepting scans after its end date; archive it when it's over.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Dates</th><th>Status</th><th>Operators</th><th></th></tr></thead>
          <tbody>{ev.events.map(e => {
            const past = e.ends_on && e.ends_on < todayDubai()
            const a = assigned[e.id] || new Set()
            return (
              <tr key={e.id} style={{ opacity: e.archived ? .55 : 1 }}>
                <td><strong>{e.name}</strong></td>
                <td className="muted">{fmtDay(e.starts_on)}{e.ends_on ? ` → ${fmtDay(e.ends_on)}` : ''}</td>
                <td>
                  {e.archived ? <span className="badge">Archived</span>
                    : e.live && past ? <span className="badge warn" title="End date has passed; scans are refused">Ended</span>
                    : e.live ? <span className="badge ok">● Live</span>
                    : <span className="badge">Not live</span>}
                </td>
                <td>
                  <button className="btn-sm btn-ghost" onClick={() => setShowOps(showOps === e.id ? null : e.id)}>{a.size} of {ops.length} {showOps === e.id ? '▴' : '▾'}</button>
                  {showOps === e.id && (
                    <div className="stack" style={{ marginTop: 6 }}>
                      {ops.length === 0 && <span className="muted small">No operator accounts yet.</span>}
                      {ops.map(o => (
                        <label key={o.id} className="row" style={{ margin: 0, fontSize: 14, color: 'var(--text)', gap: 8 }}>
                          <input type="checkbox" checked={a.has(o.id)} onChange={() => toggleOp(e, o.id)} /> <ColourDot colour={o.device_colour} />{o.full_name || o.email}{o.device_phone && <span className="muted small mono"> · {o.device_phone}</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="actions">
                  {!e.archived && (e.live
                    ? <button className="btn-sm btn-danger" onClick={() => setLive(e, false)}>End event</button>
                    : <button className="btn-sm btn-primary" onClick={() => setLive(e, true)}>Go live</button>)}
                  <button className="btn-sm btn-ghost" onClick={() => setEditing(e)}>Edit</button>
                  <button className="btn-sm btn-ghost" onClick={() => toggleArchive(e)}>{e.archived ? 'Unarchive' : 'Archive'}</button>
                  <button className="btn-sm btn-danger" onClick={() => askDelete(e)}>Delete</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </div>
    </div>
  )
}
