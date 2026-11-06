import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtFull, localToIso, nowLocal } from '../lib/format'

// The core question: which driver was in car X at time T?
export default function Search() {
  const [plates, setPlates] = useState([])
  const [plate, setPlate] = useState('')
  const [at, setAt] = useState(nowLocal())
  const [result, setResult] = useState(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('cars').select('plate').order('plate').then(({ data }) => setPlates([...new Set((data || []).map(c => c.plate))]))
  }, [])

  async function run(e) {
    e?.preventDefault(); setBusy(true)
    const { data, error } = await supabase.rpc('driver_in_car_at', { p_plate: plate.trim(), p_at: localToIso(at) })
    setBusy(false)
    if (error) { setResult({ error: error.message }); return }
    setResult(data?.[0] || null)
  }

  return (
    <div>
      <h1>Who was driving?</h1>
      <form className="card grid two" onSubmit={run}>
        <div>
          <label>Licence plate</label>
          <input list="plates" value={plate} onChange={e => setPlate(e.target.value)} placeholder="e.g. A 12345" required />
          <datalist id="plates">{plates.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div><label>Date and time (Dubai)</label><input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} required /></div>
        <div className="row" style={{ alignSelf: 'end' }}>
          <button className="btn-primary" disabled={busy}>Search</button>
          <button type="button" className="btn-ghost" onClick={() => setAt(nowLocal())}>Now</button>
        </div>
      </form>

      {result === null && <div className="alert warn">No driver was assigned to {plate.toUpperCase()} at that time (unassigned, parked, or plate not found).</div>}
      {result?.error && <div className="alert bad">{result.error}</div>}
      {result && !result.error && (
        <div className="card">
          <div className="muted small">{result.plate}</div>
          <div className="big-result">{result.driver_name}</div>
          <table style={{ marginTop: 12 }}>
            <tbody>
              <tr><th>Assigned</th><td>{fmtFull(result.assigned_at)}</td></tr>
              <tr><th>Ended</th><td>{result.ended_at ? fmtFull(result.ended_at) : <span className="badge ok">Not ended yet</span>}</td></tr>
              <tr><th>Scanned by</th><td>{result.operator_name || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
