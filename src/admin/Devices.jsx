import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FormModal, ConfirmModal } from '../components/Modal'

// The phones operators carry: colour sticker, model, SIM number, who holds it.
export const COLOURS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Black', 'White', 'Grey']
const SWATCH = { Red: '#d83c27', Orange: '#ee9a37', Yellow: '#f5e35a', Green: '#1f8a4c', Blue: '#1a56db', Purple: '#7c3aed', Pink: '#ec4899', Black: '#1f2023', White: '#ffffff', Grey: '#9ca3af' }

export function ColourDot({ colour, size = 12 }) {
  if (!colour) return null
  return <span title={colour} style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: SWATCH[colour] || colour.toLowerCase(), border: '1px solid rgba(0,0,0,.15)', verticalAlign: 'middle', marginRight: 6 }} />
}

export default function Devices() {
  const [devices, setDevices] = useState(null)
  const [ops, setOps] = useState([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [colour, setColour] = useState('Red'); const [model, setModel] = useState(''); const [phone, setPhone] = useState('')

  async function load() {
    const [{ data: d, error }, { data: o }] = await Promise.all([
      supabase.from('devices').select('*').order('colour'),
      supabase.from('operators').select('id,full_name,email,role,active').order('full_name'),
    ])
    if (error) setErr(error.message)
    setDevices(d || []); setOps((o || []).filter(x => x.active))
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('devices').insert({ colour, model: model.trim(), phone: phone.trim() })
    if (error) return setErr(error.message)
    setModel(''); setPhone(''); load()
  }
  async function assign(d, profileId) {
    const { error } = await supabase.from('devices').update({ assigned_to: profileId || null, assigned_at: profileId ? new Date().toISOString() : null }).eq('id', d.id)
    if (error) setErr(error.message); else load()
  }
  async function save(v) {
    const { error } = await supabase.from('devices').update({ colour: v.colour, model: v.model.trim(), phone: v.phone.trim(), notes: v.notes.trim() }).eq('id', editing.id)
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
        fields={[{ name: 'colour', label: 'Colour (sticker on the phone)', required: true, autoFocus: true }, { name: 'model', label: 'Model' }, { name: 'phone', label: 'SIM number' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} />}
      {deleting && <ConfirmModal title="Delete device" message={`Delete the ${deleting.colour} phone? This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}

      <form className="card grid two" onSubmit={add}>
        <div><label>Colour</label>
          <select value={colour} onChange={e => setColour(e.target.value)}>{COLOURS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label>Model (optional)</label><input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Redmi Note 14" /></div>
        <div><label>SIM number (optional, add later)</label><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="05x xxx xxxx" /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn-primary">Add device</button></div>
        <p className="muted small" style={{ gridColumn: '1/-1', margin: 0 }}>Put a coloured sticker on each phone. Assign the phone to whoever is carrying it; their colour and number then show on the Events and Operators pages and on scan records.</p>
      </form>

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Phone</th><th className="hide-mobile">Model</th><th>SIM number</th><th>Carried by</th><th></th></tr></thead>
          <tbody>
            {devices === null && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
            {devices?.length === 0 && <tr><td colSpan={5} className="muted">No devices yet.</td></tr>}
            {(devices || []).map(d => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : .55 }}>
                <td><ColourDot colour={d.colour} /><strong>{d.colour}</strong>{d.notes && <div className="muted small">{d.notes}</div>}</td>
                <td className="muted hide-mobile">{d.model}</td>
                <td className="mono">{d.phone || <span className="muted">—</span>}</td>
                <td>
                  <select className="select-inline" value={d.assigned_to || ''} onChange={e => assign(d, e.target.value)} style={{ minWidth: 160 }}>
                    <option value="">Unassigned</option>
                    {ops.map(o => <option key={o.id} value={o.id}>{o.full_name || o.email}{o.role === 'admin' ? ' (admin)' : ''}</option>)}
                  </select>
                </td>
                <td className="actions">
                  <button className="btn-sm btn-ghost" onClick={() => setEditing(d)}>Edit</button>
                  <button className="btn-sm btn-danger" onClick={() => setDeleting(d)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
