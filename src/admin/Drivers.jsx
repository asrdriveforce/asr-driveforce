import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { driverLink } from '../lib/codes'
import { csv, download } from '../lib/format'
import { useEvents, EventPicker } from '../lib/useEvents'
import { FormModal, ConfirmModal } from '../components/Modal'

export default function Drivers() {
  const ev = useEvents()
  const [drivers, setDrivers] = useState([])
  const [q, setQ] = useState('')
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('')
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState(null)

  async function load() {
    if (!ev.eventId) return
    const { data } = await supabase.from('drivers').select('*').eq('event_id', ev.eventId).order('full_name')
    setDrivers(data || [])
  }
  useEffect(() => { load() }, [ev.eventId]) // eslint-disable-line

  async function add(e) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.from('drivers').insert({ full_name: name.trim(), phone: phone.trim(), email: email.trim(), event_id: ev.eventId })
    if (error) return setErr(error.message)
    setName(''); setPhone(''); setEmail(''); load()
  }

  // Bulk import: CSV/TSV/XLSX-exported-as-CSV or pasted text. Columns found by header name; falls back to positional.
  function parseText(text) {
    const res = Papa.parse(text.trim(), { header: false, skipEmptyLines: true })
    let rows = res.data
    if (!rows.length) return []
    const head = rows[0].map(h => String(h).toLowerCase())
    const idx = (names) => head.findIndex(h => names.some(n => h.includes(n)))
    let iName = idx(['name']), iPhone = idx(['phone', 'mobile', 'tel']), iEmail = idx(['email', 'mail'])
    const hasHeader = iName >= 0 || iPhone >= 0 || iEmail >= 0
    if (hasHeader) rows = rows.slice(1); else { iName = 0; iPhone = 1; iEmail = 2 }
    // if a "first" and "last" column exist, join them
    const iFirst = head.findIndex(h => h.includes('first')), iLast = head.findIndex(h => h.includes('last'))
    return rows.map(r => ({
      full_name: (iFirst >= 0 && iLast >= 0 ? `${r[iFirst] || ''} ${r[iLast] || ''}` : (r[iName] || '')).trim(),
      phone: String(r[iPhone] ?? '').trim(), email: String(r[iEmail] ?? '').trim(), event_id: ev.eventId,
    })).filter(r => r.full_name)
  }
  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader(); reader.onload = () => setPreview(parseText(String(reader.result))); reader.readAsText(f)
    e.target.value = ''
  }
  async function importRows() {
    setErr(''); setMsg('')
    const { error } = await supabase.from('drivers').insert(preview)
    if (error) return setErr(error.message)
    setMsg(`${preview.length} drivers added`); setPreview(null); load()
  }

  async function toggle(d) { await supabase.from('drivers').update({ active: !d.active }).eq('id', d.id); load() }
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmSend, setConfirmSend] = useState(false)
  async function remove() {
    const d = deleting; setDeleting(null)
    const { error } = await supabase.from('drivers').delete().eq('id', d.id)
    if (error) setErr(error.code === '23503' ? `${d.full_name} has scan records, so they can't be deleted. Deactivate instead.` : error.message); else { setErr(''); load() }
  }
  async function save(v) {
    const { error } = await supabase.from('drivers').update({ full_name: v.full_name.trim(), phone: v.phone.trim(), email: v.email.trim() }).eq('id', editing.id)
    setEditing(null); if (error) setErr(error.message); else load()
  }
  function exportLinks() {
    download(`driveforce-driver-links-${ev.event?.name || ''}.csv`, csv(drivers, [
      { label: 'Name', key: 'full_name' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' },
      { label: 'Link', get: d => driverLink(d.code) }, { label: 'Walk-in', get: d => d.walk_in ? 'yes' : '' },
    ]))
  }
  const [sel, setSel] = useState(new Set())
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  function toggleSel(id) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function selectAllWithEmail() { setSel(new Set(shown.filter(d => d.email && d.active).map(d => d.id))) }

  async function sendCodes() {
    const ids = [...sel]
    if (!ids.length) return
    setConfirmSend(false)
    setSending(true); setSendResult(null); setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/send-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ driver_ids: ids, event_name: ev.event?.name || '', origin: window.location.origin }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || r.statusText)
      setSendResult(j); setSel(new Set())
    } catch (e) { setErr(String(e.message || e)) } finally { setSending(false) }
  }

  const needle = q.trim().toLowerCase()
  const shown = needle ? drivers.filter(d => d.full_name.toLowerCase().includes(needle) || d.phone.includes(needle) || d.email.toLowerCase().includes(needle)) : drivers

  return (
    <div>
      <div className="page-head">
        <h1>Drivers</h1>
        <div className="row"><EventPicker {...ev} /><Link className="btn btn-sm" to="/admin/print/drivers">Badges</Link><button className="btn-sm" onClick={exportLinks}>Links CSV</button></div>
      </div>
      {!ev.eventId && <div className="alert warn">Create an event first.</div>}
      {editing && <FormModal title="Edit driver" initial={editing} onClose={() => setEditing(null)} onSubmit={save}
        fields={[{ name: 'full_name', label: 'Full name', required: true, autoFocus: true }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' }]} />}
      {deleting && <ConfirmModal title="Delete driver" message={`Delete ${deleting.full_name}? This cannot be undone.`} onClose={() => setDeleting(null)} onConfirm={remove} />}
      {confirmSend && <ConfirmModal title="Send codes by email" confirmLabel={`Send to ${sel.size}`} message={`Email their personal QR code and link to ${sel.size} driver${sel.size > 1 ? 's' : ''}?`} onClose={() => setConfirmSend(false)} onConfirm={sendCodes} />}
      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert bad">{err}</div>}
      {sendResult && (
        <div className={'alert ' + (sendResult.failed.length ? 'warn' : 'ok')}>
          Sent {sendResult.sent} of {sendResult.total}.
          {sendResult.failed.length > 0 && <div className="small" style={{ marginTop: 6 }}>Not sent: {sendResult.failed.map(f => `${f.name} (${f.error})`).join('; ')}</div>}
        </div>
      )}
      <div className="grid two">
        <form className="card stack" onSubmit={add}>
          <h2>Add one</h2>
          <div><label>Full name</label><input value={name} onChange={e => setName(e.target.value)} required /></div>
          <div><label>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <div><label>Email</label><input value={email} onChange={e => setEmail(e.target.value)} /></div>
          <button className="btn-primary" disabled={!ev.eventId}>Add driver</button>
        </form>
        <div className="card stack">
          <h2>Import a list</h2>
          <p className="muted small">CSV file with columns Name, Phone, Email (header row optional; First/Last name columns also work). Save an Excel sheet as CSV first.</p>
          <input type="file" accept=".csv,.txt,.tsv" onChange={onFile} disabled={!ev.eventId} />
          <p className="muted small">Or paste names below, one per line (name, phone, email):</p>
          <textarea rows={4} onBlur={e => { if (e.target.value.trim()) setPreview(parseText(e.target.value)) }} placeholder={'Ahmed Al Mansoori, 0501234567, ahmed@example.com\nSara Khan'} />
        </div>
      </div>

      {preview && (
        <div className="card">
          <div className="row between"><h2>Import preview: {preview.length} drivers</h2><div className="row"><button className="btn-ghost btn-sm" onClick={() => setPreview(null)}>Cancel</button><button className="btn-primary btn-sm" onClick={importRows} disabled={!preview.length}>Import {preview.length}</button></div></div>
          <div className="table-wrap"><table><tbody>{preview.slice(0, 50).map((r, i) => <tr key={i}><td>{r.full_name}</td><td className="muted">{r.phone}</td><td className="muted">{r.email}</td></tr>)}</tbody></table></div>
          {preview.length > 50 && <p className="muted small">…and {preview.length - 50} more</p>}
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <input style={{ maxWidth: 320 }} placeholder="Search drivers" value={q} onChange={e => setQ(e.target.value)} />
          <div className="row">
            <span className="muted small">{drivers.length} drivers · {drivers.filter(d => d.walk_in).length} walk-ins</span>
            <button className="btn-sm btn-ghost" onClick={selectAllWithEmail}>Select all with email</button>
            <button className="btn-sm btn-primary" onClick={() => setConfirmSend(true)} disabled={sending || !sel.size}>{sending ? 'Sending…' : `Send codes by email (${sel.size})`}</button>
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th></th><th>Name</th><th className="hide-mobile">Phone</th><th className="hide-mobile">Email</th><th>Status</th><th></th></tr></thead>
          <tbody>{shown.map(d => (
            <tr key={d.id} style={{ opacity: d.active ? 1 : .5 }}>
              <td><input type="checkbox" style={{ width: 'auto' }} checked={sel.has(d.id)} disabled={!d.email} onChange={() => toggleSel(d.id)} /></td>
              <td><strong>{d.full_name}</strong> {d.walk_in && <span className="badge">walk-in</span>}</td>
              <td className="muted hide-mobile">{d.phone}</td><td className="muted hide-mobile">{d.email}</td>
              <td>{d.active ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}</td>
              <td className="actions">
                <a className="btn btn-sm btn-ghost" href={driverLink(d.code)} target="_blank" rel="noopener" title="Open the driver's personal code page">Open</a>
                <button className="btn-sm btn-ghost" title="Copy personal link" onClick={(e) => { navigator.clipboard?.writeText(driverLink(d.code)); const b = e.currentTarget; b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy link' }, 1500) }}>Copy link</button>
                <button className="btn-sm btn-ghost" onClick={() => setEditing(d)}>Edit</button>
                <button className="btn-sm btn-ghost" onClick={() => toggle(d)}>{d.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn-sm btn-danger" onClick={() => setDeleting(d)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
