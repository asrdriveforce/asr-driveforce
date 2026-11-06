import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { encodeCar, encodeDriver, encodeParkCar, PARK_ALL } from '../lib/codes'
import { useEvents, EventPicker } from '../lib/useEvents'

// Printable QR sheets: /admin/print/cars | drivers | park
export default function PrintSheet() {
  const { kind } = useParams()
  const ev = useEvents()
  const [items, setItems] = useState([])
  const [onlyNew, setOnlyNew] = useState(false)
  const [sinceDays, setSinceDays] = useState(1)

  useEffect(() => {
    if (!ev.eventId) return
    const table = kind === 'drivers' ? 'drivers' : 'cars'
    supabase.from(table).select('*').eq('event_id', ev.eventId).eq('active', true).order(kind === 'drivers' ? 'full_name' : 'plate')
      .then(({ data }) => setItems(data || []))
  }, [kind, ev.eventId])

  const cutoff = Date.now() - sinceDays * 86400000
  const shown = kind === 'drivers' && onlyNew ? items.filter(d => new Date(d.created_at).getTime() > cutoff) : items
  const title = { cars: 'Car codes', drivers: 'Driver badges', park: 'Park codes' }[kind] || 'Codes'

  return (
    <div>
      <div className="row between no-print" style={{ marginBottom: 12 }}>
        <h1>{title}</h1>
        <div className="row">
          <EventPicker {...ev} />
          {kind === 'drivers' && (
            <label className="row" style={{ margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} /> only added in last
              <input type="number" min={1} style={{ width: 70 }} value={sinceDays} onChange={e => setSinceDays(Number(e.target.value) || 1)} /> day(s)
            </label>
          )}
          <button className="btn-primary btn-sm" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <p className="muted small no-print">{shown.length} codes. Use the browser print dialog; A4, portrait, default margins.</p>

      {kind === 'park' ? (
        <div className="qr-sheet">
          <div className="qr-card big" style={{ gridColumn: '1 / -1' }}>
            <QRCodeSVG value={PARK_ALL} size={260} level="M" />
            <div className="name">PARK ALL CARS</div>
            <div className="sub">Ends every current assignment. Keep with the admin.</div>
          </div>
          {items.map(c => (
            <div className="qr-card" key={c.id}>
              <QRCodeSVG value={encodeParkCar(c.code)} size={140} level="M" />
              <div className="name">PARK {c.plate}</div>
              <div className="sub">{c.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="qr-sheet">
          {shown.map(it => (
            <div className={'qr-card' + (kind === 'cars' ? ' big' : '')} key={it.id}>
              <QRCodeSVG value={kind === 'drivers' ? encodeDriver(it.code) : encodeCar(it.code)} size={kind === 'cars' ? 220 : 150} level="M" />
              <div className="name">{kind === 'drivers' ? it.full_name : it.plate}</div>
              <div className="sub">{kind === 'drivers' ? (ev.event?.name || '') : it.label}</div>
              <div className="sub" style={{ fontFamily: 'monospace', fontSize: 10 }}>{it.code}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
