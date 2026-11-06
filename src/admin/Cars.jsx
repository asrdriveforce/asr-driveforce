import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useEvents, EventPicker } from '../lib/useEvents'

export default function Cars() {
  const ev = useEvents()
  const [cars, setCars] = useState([])
  const [plate, setPlate] = useState(''); const [label, setLabel] = useState('')
  const [bulk, setBulk] = useState(''); const [err, setErr] = useState('')

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
  async function edit(c) {
    const p = window.prompt('Plate', c.plate); if (p === null) return
    const l = window.prompt('Label (model, colour, number…)', c.label); if (l === null) return
    await supabase.from('cars').update({ plate: p.trim().toUpperCase(), label: l.trim() }).eq('id', c.id); load()
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Cars</h1>
        <div className="row"><EventPicker {...ev} /><Link className="btn btn-sm" to="/admin/print/cars">Print car codes</Link><Link className="btn btn-sm" to="/admin/print/park">Print park codes</Link></div>
      </div>
      {!ev.eventId && <div className="alert warn">Create an event first.</div>}
      <div className="grid two">
        <form className="card stack" onSubmit={add}>
          <h2>Add one</h2>
          {err && <div className="alert bad">{err}</div>}
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
          <thead><tr><th>Plate</th><th>Label</th><th>Code</th><th>Status</th><th></th></tr></thead>
          <tbody>{cars.map(c => (
            <tr key={c.id} style={{ opacity: c.active ? 1 : .5 }}>
              <td className="mono"><strong>{c.plate}</strong></td><td>{c.label}</td><td className="mono small muted">{c.code}</td>
              <td>{c.active ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}</td>
              <td className="row"><button className="btn-sm btn-ghost" onClick={() => edit(c)}>Edit</button><button className="btn-sm btn-ghost" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
