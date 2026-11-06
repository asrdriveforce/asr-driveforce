import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtFull, csv, download } from '../lib/format'
import { useEvents, EventPicker } from '../lib/useEvents'
import { Kind } from './Dashboard'

// Full scan log with filters, void, and CSV export.
export default function Records() {
  const ev = useEvents()
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')

  async function load() {
    let query = supabase.from('scans')
      .select('id,kind,scanned_at,voided,void_reason,car:cars(plate,label),driver:drivers(full_name),operator:profiles(full_name)')
      .order('scanned_at', { ascending: false }).limit(2000)
    if (ev.eventId) query = query.eq('event_id', ev.eventId)
    if (kind) query = query.eq('kind', kind)
    if (!showVoided) query = query.eq('voided', false)
    if (from) query = query.gte('scanned_at', new Date(from + 'T00:00:00+04:00').toISOString())
    if (to) query = query.lte('scanned_at', new Date(to + 'T23:59:59+04:00').toISOString())
    const { data } = await query
    setRows(data || [])
  }
  useEffect(() => { load() }, [ev.eventId, kind, showVoided, from, to]) // eslint-disable-line

  const needle = q.trim().toLowerCase()
  const shown = needle ? rows.filter(r =>
    (r.car?.plate || '').toLowerCase().includes(needle) ||
    (r.driver?.full_name || '').toLowerCase().includes(needle) ||
    (r.operator?.full_name || '').toLowerCase().includes(needle)) : rows

  async function voidRow(r) {
    const reason = window.prompt(`Void this ${r.kind} scan? Enter a reason:`)
    if (reason === null) return
    const { error } = await supabase.from('scans').update({ voided: true, voided_by: user.id, voided_at: new Date().toISOString(), void_reason: reason }).eq('id', r.id)
    if (error) alert(error.message); else load()
  }
  async function unvoidRow(r) {
    const { error } = await supabase.from('scans').update({ voided: false, voided_by: null, voided_at: null, void_reason: null }).eq('id', r.id)
    if (error) alert(error.message); else load()
  }

  function exportCsv() {
    download(`driveforce-records-${ev.event?.name || 'all'}.csv`, csv(shown, [
      { label: 'Time (Dubai)', get: r => fmtFull(r.scanned_at) }, { label: 'ISO', key: 'scanned_at' }, { label: 'Type', key: 'kind' },
      { label: 'Plate', get: r => r.car?.plate }, { label: 'Car', get: r => r.car?.label }, { label: 'Driver', get: r => r.driver?.full_name },
      { label: 'Operator', get: r => r.operator?.full_name }, { label: 'Voided', get: r => r.voided ? 'yes' : '' }, { label: 'Void reason', key: 'void_reason' },
    ]))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}><h1>Records</h1><EventPicker {...ev} allowAll /></div>
      <div className="card row no-print">
        <input style={{ flex: 2, minWidth: 180 }} placeholder="Search plate, driver, operator" value={q} onChange={e => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">All types</option><option value="assign">Assign</option><option value="checkin">Check-in</option><option value="park_car">Park car</option><option value="park_all">Park all</option>
        </select>
        <input type="date" style={{ width: 'auto' }} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" style={{ width: 'auto' }} value={to} onChange={e => setTo(e.target.value)} />
        <label style={{ margin: 0 }} className="row"><input type="checkbox" style={{ width: 'auto' }} checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> show voided</label>
        <button className="btn-sm" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="card">
        <p className="muted small">{shown.length} records{rows.length >= 2000 ? ' (showing most recent 2000, narrow the dates to see more)' : ''}</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Type</th><th>Plate</th><th>Driver</th><th>Operator</th><th></th></tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} style={{ opacity: r.voided ? .45 : 1 }}>
                <td>{fmtFull(r.scanned_at)}</td>
                <td><Kind k={r.kind} /></td>
                <td className="mono">{r.car?.plate || ''}</td>
                <td>{r.driver?.full_name || ''}</td>
                <td className="muted">{r.operator?.full_name || ''}</td>
                <td className="no-print">{r.voided
                  ? <span className="row"><span className="badge bad" title={r.void_reason}>Void: {r.void_reason}</span><button className="btn-sm btn-ghost" onClick={() => unvoidRow(r)}>Restore</button></span>
                  : <button className="btn-sm btn-danger" onClick={() => voidRow(r)}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
