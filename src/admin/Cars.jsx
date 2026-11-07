import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
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
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState('')

  // CSV: columns found by header (plate / label, model, car, description); without a header: plate, label
  function parseCars(text) {
    const res = Papa.parse(text.trim(), { header: false, skipEmptyLines: true })
    let rows = res.data
    if (!rows.length) return []
    const head = rows[0].map(h => String(h).toLowerCase().trim())
    const find = (...names) => head.findIndex(h => names.some(n => h.includes(n)))
    let iPlate = find('plate', 'reg', 'number'), iLabel = find('label', 'model', 'car', 'desc', 'vehicle', 'colour', 'color')
    const hasHeader = iPlate >= 0 || iLabel >= 0
    if (hasHeader) rows = rows.slice(1); else { iPlate = 0; iLabel = 1 }
    return rows.map(r => ({ plate: String(r[iPlate] ?? '').trim().toUpperCase(), label: iLabel >= 0 ? String(r[iLabel] ?? '').trim() : '', event_id: ev.eventId })).filter(r => r.plate)
  }
  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader(); reader.onload = () => { setPreview(parseCars(String(reader.result))); setMsg('') }; reader.readAsText(f)
    e.target.value = ''
  }
  async function importRows() {
    setErr(''); setMsg('')
    const { error } = await supabase.from('cars').insert(preview)
    if (error) return setErr(error.message)
    setMsg(`${preview.length} cars added`); setPreview(null); load()
  }

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
  async function askDelete(c) {
    const { count } = await supabase.from('scans').select('id', { count: 'exact', head: true }).eq('car_id', c.id)
    setDeleting({ ...c, scanCount: count || 0 })
  }
  async function remove() {
    const c = deleting; setDeleting(null)
    const { error } = await supabase.from('cars').delete().eq('id', c.id)
    if (error) setErr(error.message); else { setErr(''); load() }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Cars</h1>
        <div className="row"><EventPicker {...ev} /><Link className="btn btn-sm" to="/admin/print/cars">Car codes</Link><Link className="btn btn-sm" to="/admin/print/park">Park codes</Link></div>
      </div>
      {!ev.eventId && <div className="alert warn">Create an event first.</div>}
      {err && <div className="alert bad">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}
      {editing && <FormModal title="Edit car" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'plate', label: 'Licence plate', required: true, autoFocus: true }, { name: 'label', label: 'Label', placeholder: 'model, colour, number…' }]} />}
      {deleting && <ConfirmModal title="Delete car" message={`Delete ${deleting.plate}?${deleting.scanCount ? ` This also deletes its ${deleting.scanCount} scan record${deleting.scanCount === 1 ? '' : 's'}.` : ''} This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      <div className="grid two">
        <form className="card stack" onSubmit={add}>
          <h2>Add one</h2>
          <div><label>Licence plate</label><input value={plate} onChange={e => setPlate(e.target.value)} required /></div>
          <div><label>Label (optional)</label><input value={label} onChange={e => setLabel(e.target.value)} /></div>
          <button className="btn-primary" disabled={!ev.eventId}>Add car</button>
        </form>
        <div className="card stack">
          <h2>Import a list</h2>
          <p className="muted small">CSV with columns Plate and Label (or Model). Header row optional; without one the order is plate, label. Save an Excel sheet as CSV first.</p>
          <input type="file" accept=".csv,.txt,.tsv" onChange={onFile} disabled={!ev.eventId} />
          <p className="muted small">Or paste, one car per line: plate, label</p>
          <textarea rows={4} value={bulk} onChange={e => setBulk(e.target.value)} />
          <button onClick={addBulk} disabled={!ev.eventId || !bulk.trim()}>Add pasted cars</button>
        </div>
      </div>
      {preview && (
        <div className="card">
          <div className="row between"><h2>Import preview: {preview.length} cars</h2><div className="row"><button className="btn-ghost btn-sm" onClick={() => setPreview(null)}>Cancel</button><button className="btn-primary btn-sm" onClick={importRows} disabled={!preview.length}>Import {preview.length}</button></div></div>
          <div className="table-wrap"><table><tbody>{preview.slice(0, 50).map((r, i) => <tr key={i}><td className="mono"><strong>{r.plate}</strong></td><td className="muted">{r.label}</td></tr>)}</tbody></table></div>
          {preview.length > 50 && <p className="muted small">…and {preview.length - 50} more</p>}
        </div>
      )}
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
                <button className="btn-sm btn-danger" onClick={() => askDelete(c)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
