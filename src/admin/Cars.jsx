import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useEvents, EventPicker } from '../lib/useEvents'
import { FormModal, ConfirmModal } from '../components/Modal'

export default function Cars() {
  const ev = useEvents()
  const [cars, setCars] = useState([])
  const [plate, setPlate] = useState(''); const [label, setLabel] = useState('')
  const [bulk, setBulk] = useState(''); const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  async function load() {
    if (!ev.eventId) return
    const { data } = await supabase.from('cars').select('*').eq('event_id', ev.eventId).order('plate')
    setCars(data || [])
  }
  useEffect(() => { load() }, [ev.eventId]) // eslint-disable-line

  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('cars').insert({ plate: plate.trim().toUpperCase(), label: label.trim(), event_id: ev.eventId })
    if (error) return setErr(error.message)
    setPlate(''); setLabel(''); load()
  }
  async function addBulk() {
    setErr('')
    const rows = bulk.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [p, ...rest] = l.split(/[,\t]/); return { plate: p.trim().toUpperCase(), label: rest.join(',').trim(), event_id: ev.eventId }
    })
    if (!rows.length) return
    const { error } = await supabase.from('cars').insert(rows)
    if (error) return setErr(error.message)
    setBulk(''); load()
  }
  async function toggle(c) { await supabase.from('cars').update({ active: !c.active }).eq('id', c.id); load() }
  async function save(v) {
    const { error } = await supabase.from('cars').update({ plate: v.plate.trim().toUpperCase(), label: v.label.trim() }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else load()
  }
  async function remove() {
    const c = deleting; setDeleting(null)
    const { error } = await supabase.from('cars').delete().eq('id', c.id)
    if (error) setErr(error.code === '23503' ? `${c.plate} has scan records, so it can't be deleted. Deactivate it instead.` : error.message); else { setErr(''); load() }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Cars</h1>
        <div className="row"><EventPicker {...ev} /><Link className="btn btn-sm" to="/admin/print/cars">Car codes</Link><Link className="btn btn-sm" to="/admin/print/park">Park codes</Link></div>
      </div>
      {!ev.eventId && <div className="alert warn">Create an event first.</div>}
      {err && <div className="alert bad">{err}</div>}
      {editing && <FormModal title="Edit car" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'plate', label: 'Licence plate', required: true, autoFocus: true }, { name: 'label', label: 'Label', placeholder: 'model, colour, number…' }]} />}
      {deleting && <ConfirmModal title="Delete car" message={`Delete ${deleting.plate}? This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      <div className="grid two">
        <form className="card stack" onSubmit={add}>
          <h2>Add one</h2>
          <div><label>Licence plate</label><input value={plate} onChange={e => setPlate(e.target.value)} required /></div>
          <div><label>Label (optional)</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Urus, white, #7" /></div>
          <button className="btn-primary" disabled={!ev.eventId}>Add car</button>
        </form>
        <div className="card stack">
          <h2>Add many</h2>
          <p className="muted small">One car per line: plate, label</p>
          <textarea rows={6} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'A 12345, Urus white\nB 777, Huracán green'} />
          <button onClick={addBulk} disabled={!ev.eventId || !bulk.trim()}>Add all</button>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Plate</th><th>Label</th><th className="hide-mobile">Code</th><th>Status</th><th></th></tr></thead>
          <tbody>{cars.map(c => (
            <tr key={c.id} style={{ opacity: c.active ? 1 : .55 }}>
              <td className="mono"><strong>{c.plate}</strong></td><td>{c.label}</td><td className="mono small muted hide-mobile">{c.code}</td>
              <td>{c.active ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}</td>
              <td className="actions">
                <button className="btn-sm btn-ghost" onClick={() => setEditing(c)}>Edit</button>
                <button className="btn-sm btn-ghost" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn-sm btn-danger" onClick={() => setDeleting(c)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
