import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmt } from '../lib/format'
import { FormModal, ConfirmModal } from '../components/Modal'

// The phones operators carry: colour sticker, model, SIM number, who holds it.
export const COLOURS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Black', 'White', 'Grey']
const SWATCH = { Red: '#d83c27', Orange: '#ee9a37', Yellow: '#f5e35a', Green: '#1f8a4c', Blue: '#1a56db', Purple: '#7c3aed', Pink: '#ec4899', Black: '#1f2023', White: '#ffffff', Grey: '#9ca3af' }

export function ColourDot({ colour, size = 12 }) {
  if (!colour) return null
  return <span title={colour} style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: SWATCH[colour] || colour.toLowerCase(), border: '1px solid rgba(0,0,0,.15)', verticalAlign: 'middle', marginRight: 6 }} />
}

export default function Devices() {
  const { user } = useAuth()
  const [devices, setDevices] = useState(null)
  const [log, setLog] = useState([])
  const [ops, setOps] = useState([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [colour, setColour] = useState('Red'); const [phone, setPhone] = useState('')

  async function load() {
    const [{ data: d, error }, { data: o }, { data: l }] = await Promise.all([
      supabase.from('devices').select('*').order('colour'),
      supabase.from('operators').select('id,full_name,email,role,active').order('full_name'),
      supabase.from('device_events').select('id,kind,at,device:devices(colour),who:profiles!device_events_profile_id_fkey(full_name),by:profiles!device_events_by_id_fkey(full_name)').order('at', { ascending: false }).limit(100),
    ])
    if (error) setErr(error.message)
    setDevices(d || []); setOps((o || []).filter(x => x.active)); setLog(l || [])
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('devices').insert({ colour, phone: phone.trim() })
    if (error) return setErr(error.message)
    setPhone(''); load()
  }
  // Hand out: assign and log. Hand back: clear and log. Changing holder directly logs a back for the old holder and an out for the new.
  async function assign(d, profileId) {
    const now = new Date().toISOString()
    const events = []
    if (d.assigned_to) events.push({ device_id: d.id, kind: 'back', profile_id: d.assigned_to, by_id: user.id, at: now })
    if (profileId) events.push({ device_id: d.id, kind: 'out', profile_id: profileId, by_id: user.id, at: now })
    const { error } = await supabase.from('devices').update({ assigned_to: profileId || null, assigned_at: profileId ? now : null }).eq('id', d.id)
    if (error) return setErr(error.message)
    if (events.length) await supabase.from('device_events').insert(events)
    load()
  }
  async function save(v) {
    const { error } = await supabase.from('devices').update({ colour: v.colour, phone: v.phone.trim(), notes: v.notes.trim() }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else load()
  }
  async function remove() {
    const d = deleting; setDeleting(null)
    const { error } = await supabase.from('devices').delete().eq('id', d.id)
    if (error) setErr(error.message); else load()
  }
  const opName = (id) => { const o = ops.find(x => x.id === id); return o ? (o.full_name || o.email) : '' }

  return (
    <div>
      <div className="page-head"><h1>Devices</h1></div>
      {err && <div className="alert bad">{err}</div>}
      {editing && <FormModal title="Edit device" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'colour', label: 'Colour (sticker on the phone)', required: true, autoFocus: true }, { name: 'phone', label: 'SIM number' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} />}
      {deleting && <ConfirmModal title="Delete device" message={`Delete the ${deleting.colour} phone? This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}

      <form className="card grid two" onSubmit={add}>
        <div><label>Colour</label>
          <select value={colour} onChange={e => setColour(e.target.value)}>{COLOURS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label>SIM number (optional, add later)</label><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="05x xxx xxxx" /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn-primary">Add device</button></div>
        <p className="muted small" style={{ gridColumn: '1/-1', margin: 0 }}>Put a coloured sticker on each phone. Assign the phone to whoever is carrying it; their colour and number then show on the Events and Operators pages and on scan records.</p>
      </form>

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Phone</th><th>SIM number</th><th>Hand out to</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {devices === null && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
            {devices?.length === 0 && <tr><td colSpan={5} className="muted">No devices yet.</td></tr>}
            {(devices || []).map(d => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : .55 }}>
                <td><ColourDot colour={d.colour} /><strong>{d.colour}</strong>{d.notes && <div className="muted small">{d.notes}</div>}</td>
                <td className="mono">{d.phone || <span className="muted">—</span>}</td>
                <td>
                  <select className="select-inline" value={d.assigned_to || ''} onChange={e => assign(d, e.target.value)} style={{ minWidth: 160 }}>
                    <option value="">— In stock —</option>
                    {ops.map(o => <option key={o.id} value={o.id}>{o.full_name || o.email}{o.role === 'admin' ? ' (admin)' : ''}</option>)}
                  </select>
                </td>
                <td>{d.assigned_to
                  ? <><span className="badge accent">Out</span><div className="muted small">{opName(d.assigned_to)} since {fmt(d.assigned_at)}</div></>
                  : <span className="badge ok">In stock</span>}</td>
                <td className="actions">
                  {d.assigned_to && <button className="btn-sm" onClick={() => assign(d, '')}>Returned</button>}
                  <button className="btn-sm btn-ghost" onClick={() => setEditing(d)}>Edit</button>
                  <button className="btn-sm btn-danger" onClick={() => setDeleting(d)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h2>Hand-out log</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Phone</th><th>Action</th><th>Operator</th><th className="hide-mobile">Logged by</th></tr></thead>
          <tbody>
            {log.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
            {log.map(l => (
              <tr key={l.id}>
                <td>{fmt(l.at)}</td>
                <td><ColourDot colour={l.device?.colour} />{l.device?.colour}</td>
                <td>{l.kind === 'out' ? <span className="badge accent">Handed out</span> : <span className="badge ok">Returned</span>}</td>
                <td>{l.who?.full_name || ''}</td>
                <td className="muted hide-mobile">{l.by?.full_name || ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
