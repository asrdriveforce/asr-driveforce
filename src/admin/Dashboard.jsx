import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fmt, dayKey } from '../lib/format'
import { useEvents, EventPicker } from '../lib/useEvents'

// Live view: which car has which driver right now, plus today's numbers.
export default function Dashboard() {
  const ev = useEvents()
  const [cars, setCars] = useState([])
  const [live, setLive] = useState({})
  const [today, setToday] = useState({ assigns: 0, checkins: 0, drivers: 0 })
  const [recent, setRecent] = useState([])
  const [equipOut, setEquipOut] = useState([])

  async function load() {
    if (!ev.eventId) return
    const { data: cs } = await supabase.from('cars').select('*').eq('event_id', ev.eventId).eq('active', true).order('plate')
    setCars(cs || [])
    const now = new Date().toISOString()
    const results = await Promise.all((cs || []).map(c => supabase.rpc('driver_in_car_at', { p_plate: c.plate, p_at: now })))
    const m = {}
    results.forEach((r, i) => { if (r.data?.[0]) m[cs[i].id] = r.data[0] })
    setLive(m)

    const since = new Date(); since.setHours(since.getHours() - 36)
    const { data: scans } = await supabase.from('scans')
      .select('id,kind,scanned_at,voided,car:cars(plate),driver:drivers(full_name),operator:profiles!scans_operator_id_fkey(full_name)')
      .eq('event_id', ev.eventId).gte('scanned_at', since.toISOString()).order('scanned_at', { ascending: false }).limit(300)
    const tk = dayKey(new Date())
    const todays = (scans || []).filter(s => !s.voided && dayKey(s.scanned_at) === tk)
    setToday({
      assigns: todays.filter(s => s.kind === 'assign').length,
      checkins: todays.filter(s => s.kind === 'checkin').length,
      drivers: new Set(todays.filter(s => s.kind === 'assign').map(s => s.driver?.full_name)).size,
    })
    setRecent((scans || []).slice(0, 15))
    const { data: eq } = await supabase.rpc('equipment_status')
    setEquipOut((eq || []).filter(i => i.event_id === ev.eventId && i.missing_slots?.length))
  }
  useEffect(() => { load() }, [ev.eventId]) // eslint-disable-line
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t) }) // eslint-disable-line

  if (ev.loaded && !ev.events.length) return (
    <div className="card"><h1>Welcome</h1><p>Start by creating an event, then add cars and drivers.</p><Link className="btn btn-primary" to="/admin/events">Create event</Link></div>
  )

  return (
    <div>
      <div className="page-head">
        <h1>Dashboard</h1>
        <EventPicker {...ev} />
      </div>
      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <div className="card kpi-card"><div className="kpi-label">Cars in use</div><div className="kpi">{Object.keys(live).length}<span className="muted" style={{ fontSize: 16, fontWeight: 600 }}> / {cars.length}</span></div></div>
        <div className="card kpi-card"><div className="kpi-label">Drives today</div><div className="kpi">{today.assigns}</div></div>
        <div className="card kpi-card"><div className="kpi-label">Drivers today</div><div className="kpi">{today.drivers}</div></div>
        <div className="card kpi-card"><div className="kpi-label">Check-ins today</div><div className="kpi">{today.checkins}</div></div>
      </div>

      <div className="card">
        <h2>Fleet right now</h2>
        {!cars.length && <p className="muted">No cars in this event yet. <Link to="/admin/cars">Add cars</Link>.</p>}
        <div className="table-wrap"><table>
          <thead><tr><th>Plate</th><th>Car</th><th>Driver</th><th>Since</th><th>Operator</th></tr></thead>
          <tbody>
            {cars.map(c => {
              const l = live[c.id]
              return (
                <tr key={c.id}>
                  <td className="mono"><strong>{c.plate}</strong></td>
                  <td className="muted">{c.label}</td>
                  <td>{l ? l.driver_name : <span className="badge">Parked</span>}</td>
                  <td>{l ? fmt(l.assigned_at) : ''}</td>
                  <td className="muted">{l?.operator_name || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </div>

      {equipOut.length > 0 && (
        <div className="card">
          <div className="row between"><h2>Equipment out</h2><Link to="/admin/equipment" className="small">Equipment →</Link></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th>Holder</th><th>Since</th><th>Status</th></tr></thead>
            <tbody>{equipOut.map(i => (
              <tr key={i.id}><td><strong>{i.name}</strong></td><td>{i.holder_name}</td><td>{fmt(i.issued_at)}</td>
                <td>{i.missing_slots.length === i.slots ? <span className="badge accent">Out</span> : <span className="badge bad">Missing {i.missing_slots.join(', ')}</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <div className="card">
        <div className="row between"><h2>Latest scans</h2><Link to="/admin/records" className="small">All records →</Link></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Type</th><th>Car</th><th>Driver</th><th>Operator</th></tr></thead>
          <tbody>
            {recent.map(s => (
              <tr key={s.id} style={{ opacity: s.voided ? .4 : 1 }}>
                <td>{fmt(s.scanned_at)}</td>
                <td><Kind k={s.kind} /></td>
                <td className="mono">{s.car?.plate || ''}</td>
                <td>{s.driver?.full_name || ''}</td>
                <td className="muted">{s.operator?.full_name || ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}

export function Kind({ k }) {
  const map = { assign: ['accent', 'Assign'], checkin: ['ok', 'Check-in'], park_car: ['', 'Park car'], park_all: ['warn', 'Park all'] }
  const [cls, label] = map[k] || ['', k]
  return <span className={'badge ' + cls}>{label}</span>
}
