import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmt, fmtFull, csv, download } from '../lib/format'
import { useEvents, EventPicker } from '../lib/useEvents'
import { FormModal, ConfirmModal } from '../components/Modal'

// Equipment: items with numbered slots (a radio block with 6 radios, a helmet rack with 10 helmets).
export default function Equipment() {
  const ev = useEvents()
  const { user } = useAuth()
  const [items, setItems] = useState(null)   // null = loading
  const [history, setHistory] = useState([])
  const [name, setName] = useState(''); const [slots, setSlots] = useState(6)
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [found, setFound] = useState(null)   // { item, slot }
  const [confirmAll, setConfirmAll] = useState(false)
  async function returnAll() {
    setConfirmAll(false)
    const { data, error } = await supabase.rpc('return_all_equipment', { p_event: ev.eventId })
    if (error) setErr(error.message); else { setMsg(`${data} item${data === 1 ? '' : 's'} marked returned`); load() }
  }

  async function load() {
    if (!ev.eventId) return
    const [{ data: st, error }, { data: h }] = await Promise.all([
      supabase.rpc('equipment_status'),
      supabase.from('equipment_events')
        .select('id,kind,slots,scanned_at,note,item:equipment(name),driver:drivers(full_name),operator:profiles!equipment_events_operator_id_fkey(full_name)')
        .eq('event_id', ev.eventId).order('scanned_at', { ascending: false }).limit(200),
    ])
    if (error) setErr(error.message)
    setItems((st || []).filter(i => i.event_id === ev.eventId))
    setHistory(h || [])
  }
  useEffect(() => { setItems(null); load() }, [ev.eventId]) // eslint-disable-line
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t) }) // eslint-disable-line

  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('equipment').insert({ name: name.trim(), slots: Number(slots) || 1, event_id: ev.eventId })
    if (error) return setErr(error.message)
    setName(''); load()
  }
  async function save(v) {
    const { error } = await supabase.from('equipment').update({ name: v.name.trim(), slots: Number(v.slots) || 1 }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else load()
  }
  async function toggle(i) { await supabase.from('equipment').update({ active: !i.active }).eq('id', i.id); load() }
  async function remove() {
    const i = deleting; setDeleting(null)
    const { error } = await supabase.from('equipment').delete().eq('id', i.id)
    if (error) setErr(error.message); else load()
  }
  // Admin marks a missing slot as found / returned without a scan
  async function markFound() {
    const { item, slot } = found; setFound(null)
    const { error } = await supabase.from('equipment_events').insert({ kind: 'return', equipment_id: item.id, slots: [slot], operator_id: user.id, event_id: ev.eventId, note: 'Marked returned by admin' })
    if (error) setErr(error.message); else { setMsg(`${item.name} #${slot} marked returned`); load() }
  }

  const loading = items === null
  const list = items || []
  const out = list.filter(i => i.missing_slots?.length)
  const short = out.filter(i => i.missing_slots.length < i.slots)   // partly returned
  const totalMissing = out.reduce((n, i) => n + i.missing_slots.length, 0)

  function exportCsv() {
    download(`driveforce-equipment-${ev.event?.name || ''}.csv`, csv(list, [
      { label: 'Item', key: 'name' }, { label: 'Slots', key: 'slots' }, { label: 'Status', get: i => i.missing_slots?.length ? (i.missing_slots.length === i.slots ? 'Out' : 'Partly returned') : 'In stock' },
      { label: 'Missing', get: i => (i.missing_slots || []).join(' ') }, { label: 'Holder', key: 'holder_name' }, { label: 'Issued at', get: i => i.issued_at ? fmtFull(i.issued_at) : '' }, { label: 'Issued by', key: 'issued_by' },
    ]))
  }

  return (
    <div>
      <div className="page-head">
        <h1>Equipment</h1>
        <div className="row"><EventPicker {...ev} /><Link className="btn btn-sm" to="/admin/print/equipment">Print codes</Link><button className="btn-sm" onClick={exportCsv}>Export CSV</button><button className="btn-sm btn-primary" onClick={() => setConfirmAll(true)} disabled={!out.length}>All equipment back</button></div>
      </div>
      {!ev.eventId && <div className="alert warn">Create an event first.</div>}
      {err && <div className="alert bad">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}
      {editing && <FormModal title="Edit item" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'name', label: 'Name', required: true, autoFocus: true }, { name: 'slots', label: 'Units in it (1 for a single item)', type: 'number', required: true }]} />}
      {deleting && <ConfirmModal title="Delete item" message={`Delete ${deleting.name} and its issue/return history? This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      {confirmAll && <ConfirmModal title="All equipment back" confirmLabel="Mark all returned" message={`Mark every outstanding unit of ${out.length} item${out.length === 1 ? '' : 's'} as returned? Items with missing units should be returned individually first so the gap is recorded.`} onClose={() => setConfirmAll(false)} onConfirm={returnAll} />}
      {found && <ConfirmModal title="Mark returned" confirmLabel="Mark returned" message={`Mark ${found.item.name} #${found.slot} as returned? This is logged in your name.`} onClose={() => setFound(null)} onConfirm={markFound} />}

      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <div className="card kpi-card"><div className="kpi-label">Items</div><div className="kpi">{loading ? <span className="muted">…</span> : list.length}</div></div>
        <div className="card kpi-card"><div className="kpi-label">Out now</div><div className="kpi">{loading ? <span className="muted">…</span> : out.length}</div></div>
        <div className="card kpi-card"><div className="kpi-label">Units not back</div><div className="kpi" style={!loading && totalMissing ? { color: 'var(--bad)' } : {}}>{loading ? <span className="muted">…</span> : totalMissing}</div></div>
        <div className="card kpi-card"><div className="kpi-label">Partly returned</div><div className="kpi" style={!loading && short.length ? { color: 'var(--bad)' } : {}}>{loading ? <span className="muted">…</span> : short.length}</div></div>
      </div>

      <div className="card">
        <h2>Status</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Status</th><th>Holder</th><th>Since</th><th className="hide-mobile">Issued by</th><th></th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={6} className="muted">Loading…</td></tr> : list.map(i => {
            const missing = i.missing_slots || []
            const status = !missing.length ? <span className="badge ok">In stock</span> : missing.length === i.slots ? <span className="badge accent">Out</span> : <span className="badge bad">Missing {missing.join(', ')}</span>
            return (
              <tr key={i.id} style={{ opacity: i.active ? 1 : .55 }}>
                <td><strong>{i.name}</strong><div className="muted small">{i.slots} {i.slots === 1 ? 'unit' : 'units'}</div></td>
                <td>{status}{missing.length > 0 && missing.length < i.slots && <div className="row" style={{ gap: 4, marginTop: 4 }}>{missing.map(n => <button key={n} className="btn-sm btn-ghost" onClick={() => setFound({ item: i, slot: n })}>#{n} found</button>)}</div>}</td>
                <td>{missing.length ? i.holder_name : <span className="muted">—</span>}</td>
                <td className="muted">{missing.length && i.issued_at ? fmt(i.issued_at) : ''}</td>
                <td className="muted hide-mobile">{missing.length ? i.issued_by : ''}</td>
                <td className="actions">
                  <button className="btn-sm btn-ghost" onClick={() => setEditing(i)}>Edit</button>
                  <button className="btn-sm btn-ghost" onClick={() => toggle(i)}>{i.active ? 'Deactivate' : 'Activate'}</button>
                  <button className="btn-sm btn-danger" onClick={() => setDeleting(i)}>Delete</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </div>

      <form className="card grid two" onSubmit={add}>
        <div><label>Item name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Radio block B" required /></div>
        <div><label>Units in it</label><input type="number" min={1} max={50} value={slots} onChange={e => setSlots(e.target.value)} /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn-primary" disabled={!ev.eventId}>Add item</button></div>
        <p className="muted small" style={{ gridColumn: '1/-1', margin: 0 }}>One QR code per item. Number the units inside it 1 to N. A single item (one helmet, one laptop) is 1 unit.</p>
      </form>

      <div className="card">
        <h2>History</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Item</th><th>Action</th><th>Person</th><th className="hide-mobile">Operator</th></tr></thead>
          <tbody>{history.map(h => (
            <tr key={h.id}>
              <td>{fmt(h.scanned_at)}</td>
              <td>{h.item?.name}</td>
              <td>{h.kind === 'issue' ? <span className="badge accent">Issued</span> : <span className="badge ok">Returned {h.slots?.length ? h.slots.join(', ') : ''}</span>}{h.note && <div className="muted small">{h.note}</div>}</td>
              <td>{h.driver?.full_name || ''}</td>
              <td className="muted hide-mobile">{h.operator?.full_name}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
