import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { fmtFull, csv, download } from '../lib/format'

// Match a list of fines (plate + time) to the driver in that car at that time.
// Input: CSV upload or pasted rows. Columns found by header (plate, date/time, reference, amount, description),
// otherwise positional: plate, datetime, reference.
const NEAR_MINUTES = 3 // flag when the offence is within this many minutes of an assignment change

const normPlate = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, '')

function parseWhen(v) {
  if (v == null || v === '') return null
  let s = String(v).trim()
  // dd/mm/yyyy hh:mm[:ss]  or  dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, d, mo, y, h, mi, se] = m
    const yy = y.length === 2 ? '20' + y : y
    return new Date(`${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se || '00'}+04:00`)
  }
  // yyyy-mm-dd hh:mm
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) { const [, y, mo, d, h, mi, se] = m; return new Date(`${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:${se || '00'}+04:00`) }
  const dt = new Date(s)
  return isNaN(dt) ? null : dt
}

function parseFines(text) {
  const res = Papa.parse(text.trim(), { header: false, skipEmptyLines: true })
  let rows = res.data
  if (!rows.length) return []
  const head = rows[0].map(h => String(h).toLowerCase().trim())
  const find = (...names) => head.findIndex(h => names.some(n => h.includes(n)))
  let iPlate = find('plate', 'number', 'reg'), iWhen = find('date', 'time', 'when'), iRef = find('ref', 'fine', 'ticket', 'no.', 'id'), iAmt = find('amount', 'aed', 'fee'), iDesc = find('desc', 'offence', 'offense', 'violation', 'type')
  // a separate time column alongside a date column
  const iDate = head.findIndex(h => h.includes('date')), iTime = head.findIndex(h => h === 'time' || h.includes('time') && !h.includes('date'))
  const hasHeader = iPlate >= 0 || iWhen >= 0
  if (hasHeader) rows = rows.slice(1); else { iPlate = 0; iWhen = 1; iRef = 2 }
  return rows.map((r, i) => {
    let whenStr = iDate >= 0 && iTime >= 0 && iDate !== iTime ? `${r[iDate]} ${r[iTime]}` : r[iWhen]
    return {
      n: i + 1, plate: String(r[iPlate] ?? '').trim(), whenStr: String(whenStr ?? '').trim(), when: parseWhen(whenStr),
      ref: iRef >= 0 ? String(r[iRef] ?? '').trim() : '', amount: iAmt >= 0 ? String(r[iAmt] ?? '').trim() : '', desc: iDesc >= 0 ? String(r[iDesc] ?? '').trim() : '',
    }
  }).filter(f => f.plate)
}

export default function Fines() {
  const [fines, setFines] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader(); reader.onload = () => { setFines(parseFines(String(reader.result))); setResults(null) }; reader.readAsText(f)
    e.target.value = ''
  }

  async function match() {
    if (!fines?.length) return
    setBusy(true); setErr(''); setResults(null)
    try {
      // Pull every assignment with its end time once, then match locally.
      const { data: hist, error } = await supabase.from('assignment_history').select('*').eq('voided', false).order('assigned_at')
      if (error) throw new Error(error.message)
      const { data: drivers } = await supabase.from('drivers').select('id,phone,email')
      const contact = Object.fromEntries((drivers || []).map(d => [d.id, d]))
      const byPlate = {}
      for (const h of hist || []) (byPlate[normPlate(h.plate)] ||= []).push(h)
      const out = fines.map(f => {
        const base = { ...f }
        if (!f.when) return { ...base, status: 'bad_time', note: 'Could not read the date/time' }
        const list = byPlate[normPlate(f.plate)]
        if (!list) return { ...base, status: 'unknown_plate', note: 'Plate not in DriveForce' }
        const t = f.when.getTime()
        const hit = list.find(h => new Date(h.assigned_at).getTime() <= t && (!h.ended_at || new Date(h.ended_at).getTime() > t))
        if (!hit) {
          // nearest assignment either side, for context
          const near = list.reduce((best, h) => { const d = Math.abs(new Date(h.assigned_at).getTime() - t); return d < best.d ? { d, h } : best }, { d: Infinity, h: null })
          return { ...base, status: 'unassigned', note: near.h ? `No driver at that time. Nearest: ${near.h.driver_name} from ${fmtFull(near.h.assigned_at)}` : 'No assignments for this car' }
        }
        const startGap = (t - new Date(hit.assigned_at).getTime()) / 60000
        const endGap = hit.ended_at ? (new Date(hit.ended_at).getTime() - t) / 60000 : Infinity
        const near = Math.min(startGap, endGap) < NEAR_MINUTES
        const c = contact[hit.driver_id] || {}
        return { ...base, status: near ? 'near_swap' : 'matched', driver: hit.driver_name, driver_id: hit.driver_id, phone: c.phone || '', email: c.email || '',
          assigned_at: hit.assigned_at, ended_at: hit.ended_at, operator: hit.operator_name,
          note: near ? `Within ${NEAR_MINUTES} min of a driver change: verify` : '' }
      })
      setResults(out)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  function exportCsv() {
    download('driveforce-fines-matched.csv', csv(results, [
      { label: 'Reference', key: 'ref' }, { label: 'Plate', key: 'plate' }, { label: 'Offence time', key: 'whenStr' }, { label: 'Description', key: 'desc' }, { label: 'Amount', key: 'amount' },
      { label: 'Driver', key: 'driver' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' },
      { label: 'Status', key: 'status' }, { label: 'Assigned from', get: r => r.assigned_at ? fmtFull(r.assigned_at) : '' }, { label: 'Assigned until', get: r => r.ended_at ? fmtFull(r.ended_at) : '' },
      { label: 'Scanned by', key: 'operator' }, { label: 'Note', key: 'note' },
    ]))
  }

  const Status = ({ s }) => ({
    matched: <span className="badge ok">Matched</span>, near_swap: <span className="badge warn">Verify</span>,
    unassigned: <span className="badge bad">No driver</span>, unknown_plate: <span className="badge bad">Unknown plate</span>, bad_time: <span className="badge bad">Bad time</span>,
  }[s])

  const counts = results ? results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {}) : null

  return (
    <div>
      <div className="page-head"><h1>Fines</h1>{results && <button className="btn-sm" onClick={exportCsv}>Export CSV</button>}</div>
      {err && <div className="alert bad">{err}</div>}
      <div className="grid two">
        <div className="card stack">
          <h2>Upload fines</h2>
          <p className="muted small">CSV with columns for plate, date/time and reference (amount and description optional). Header names are detected; without a header the order is plate, date-time, reference. Times are read as Dubai time; formats like 06/11/2026 13:52 or 2026-11-06 13:52 both work.</p>
          <input type="file" accept=".csv,.txt,.tsv" onChange={onFile} />
          <p className="muted small">Or paste rows:</p>
          <textarea rows={5} placeholder={'40 40632, 06/11/2026 13:52, FN-12345\n50 12345, 06/11/2026 15:10, FN-12346'} onBlur={e => { if (e.target.value.trim()) { setFines(parseFines(e.target.value)); setResults(null) } }} />
        </div>
        <div className="card stack">
          <h2>How matching works</h2>
          <p className="small">Each fine is matched to the driver assigned to that plate at the offence time, using the scan log. A fine within {NEAR_MINUTES} minutes of a driver change is flagged "Verify". A fine while the car was parked or before any scan is flagged "No driver".</p>
          <button className="btn-primary" onClick={match} disabled={!fines?.length || busy}>{busy ? 'Matching…' : `Match ${fines?.length || 0} fine${fines?.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>

      {fines && !results && (
        <div className="card">
          <h2>Loaded {fines.length} fines</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Plate</th><th>Time (as read)</th><th>Reference</th></tr></thead>
            <tbody>{fines.slice(0, 50).map(f => <tr key={f.n}><td>{f.n}</td><td className="mono">{f.plate}</td><td>{f.when ? fmtFull(f.when) : <span className="badge bad">unreadable: {f.whenStr}</span>}</td><td>{f.ref}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}

      {results && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="badge ok">{counts.matched || 0} matched</span>
            <span className="badge warn">{counts.near_swap || 0} verify</span>
            <span className="badge bad">{(counts.unassigned || 0) + (counts.unknown_plate || 0) + (counts.bad_time || 0)} unmatched</span>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Reference</th><th>Plate</th><th>Offence time</th><th>Driver</th><th className="hide-mobile">Phone</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>{results.map(r => (
              <tr key={r.n}>
                <td>{r.ref || <span className="muted">#{r.n}</span>}</td>
                <td className="mono">{r.plate}</td>
                <td>{r.when ? fmtFull(r.when) : r.whenStr}</td>
                <td><strong>{r.driver || ''}</strong>{r.assigned_at && <div className="muted small">{fmtFull(r.assigned_at)} → {r.ended_at ? fmtFull(r.ended_at) : 'open'}</div>}</td>
                <td className="muted hide-mobile">{r.phone}</td>
                <td><Status s={r.status} /></td>
                <td className="small muted">{r.note}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
