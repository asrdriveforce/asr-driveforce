import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, dayKey, csv, download } from '../lib/format'
import { useEvents, EventPicker } from '../lib/useEvents'

// Per-day: who checked in, who drove, who was registered but never appeared.
export default function Attendance() {
  const ev = useEvents()
  const [day, setDay] = useState(dayKey(new Date()))
  const [rows, setRows] = useState([])

  async function load() {
    if (!ev.eventId) return
    const [{ data: drivers }, { data: scans }] = await Promise.all([
      supabase.from('drivers').select('id,full_name,phone,email,walk_in').eq('event_id', ev.eventId).eq('active', true).order('full_name'),
      supabase.from('scans').select('kind,driver_id,scanned_at,car:cars(plate)').eq('event_id', ev.eventId).eq('voided', false)
        .gte('scanned_at', new Date(day + 'T00:00:00+04:00').toISOString()).lte('scanned_at', new Date(day + 'T23:59:59+04:00').toISOString()),
    ])
    const byDriver = {}
    for (const s of scans || []) {
      if (!s.driver_id) continue
      const d = byDriver[s.driver_id] ||= { checkin: null, drives: [] }
      if (s.kind === 'checkin' && (!d.checkin || s.scanned_at < d.checkin)) d.checkin = s.scanned_at
      if (s.kind === 'assign') d.drives.push(s)
    }
    setRows((drivers || []).map(d => ({ ...d, ...(byDriver[d.id] || { checkin: null, drives: [] }) })))
  }
  useEffect(() => { load() }, [ev.eventId, day]) // eslint-disable-line

  const present = rows.filter(r => r.checkin || r.drives.length)
  const absent = rows.filter(r => !r.checkin && !r.drives.length)

  function exportCsv() {
    download(`driveforce-attendance-${day}.csv`, csv(rows, [
      { label: 'Driver', key: 'full_name' }, { label: 'Phone', key: 'phone' }, { label: 'Walk-in', get: r => r.walk_in ? 'yes' : '' },
      { label: 'Checked in', get: r => r.checkin ? fmt(r.checkin) : '' }, { label: 'Drives', get: r => r.drives.length },
      { label: 'Cars', get: r => r.drives.map(x => x.car?.plate).join(' | ') },
    ]))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Attendance</h1>
        <div className="row"><input type="date" style={{ width: 'auto' }} value={day} onChange={e => setDay(e.target.value)} /><EventPicker {...ev} /><button className="btn-sm" onClick={exportCsv}>Export CSV</button></div>
      </div>
      <div className="grid two" style={{ marginBottom: 14 }}>
        <div className="card"><div className="muted small">Registered</div><div className="kpi">{rows.length}</div></div>
        <div className="card"><div className="muted small">Present</div><div className="kpi">{present.length}</div></div>
        <div className="card"><div className="muted small">Drove</div><div className="kpi">{rows.filter(r => r.drives.length).length}</div></div>
        <div className="card"><div className="muted small">No-show</div><div className="kpi">{absent.length}</div></div>
      </div>
      <div className="card">
        <h2>Present</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Driver</th><th>Checked in</th><th>Drives</th><th>Cars</th></tr></thead>
          <tbody>{present.map(r => (
            <tr key={r.id}><td>{r.full_name} {r.walk_in && <span className="badge">walk-in</span>}</td><td>{r.checkin ? fmt(r.checkin) : <span className="muted">no check-in</span>}</td><td>{r.drives.length}</td><td className="mono small">{r.drives.map(x => x.car?.plate).join(', ')}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>No-show</h2>
        <p className="muted small">Registered to this event but no check-in or drive on {day}.</p>
        <div className="table-wrap"><table><tbody>{absent.map(r => <tr key={r.id}><td>{r.full_name}</td><td className="muted">{r.phone}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  )
}
