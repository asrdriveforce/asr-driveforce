import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { encodeCar, encodeDriver, encodeParkCar, encodeEquipment, PARK_ALL } from '../lib/codes'
import { useEvents, EventPicker } from '../lib/useEvents'
import { qrPng, saveBlob, safeName, zipPngs } from '../lib/qrpng'

// Printable QR sheets: /admin/print/cars | drivers | park
export default function PrintSheet() {
  const { kind } = useParams()
  const ev = useEvents()
  const [items, setItems] = useState([])
  const [onlyNew, setOnlyNew] = useState(false)
  const [sinceDays, setSinceDays] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!ev.eventId) return
    const table = kind === 'drivers' ? 'drivers' : kind === 'equipment' ? 'equipment' : 'cars'
    supabase.from(table).select('*').eq('event_id', ev.eventId).eq('active', true).order(kind === 'drivers' ? 'full_name' : kind === 'equipment' ? 'name' : 'plate')
      .then(({ data }) => setItems(data || []))
  }, [kind, ev.eventId])

  const cutoff = Date.now() - sinceDays * 86400000
  const shown = kind === 'drivers' && onlyNew ? items.filter(d => new Date(d.created_at).getTime() > cutoff) : items
  const title = { cars: 'Car codes', drivers: 'Driver badges', park: 'Park codes', equipment: 'Equipment codes' }[kind] || 'Codes'
  const evName = ev.event?.name || ''

  // One descriptor per code, used for both single PNG and zip
  function spec(it) {
    if (kind === 'drivers') return { value: encodeDriver(it.code), title: it.full_name, subtitle: evName, footer: it.code, name: `driver_${safeName(it.full_name)}_${it.code}.png` }
    if (kind === 'cars') return { value: encodeCar(it.code), title: it.plate, subtitle: it.label, footer: it.code, name: `car_${safeName(it.plate)}.png` }
    if (kind === 'equipment') return { value: encodeEquipment(it.code), title: it.name, subtitle: `${it.slots} ${it.slots === 1 ? 'piece' : 'pieces'}`, footer: it.code, name: `equipment_${safeName(it.name)}.png` }
    return { value: encodeParkCar(it.code), title: `PARK ${it.plate}`, subtitle: it.label, name: `park_${safeName(it.plate)}.png` }
  }
  const parkAll = { value: PARK_ALL, title: 'PARK ALL CARS', subtitle: 'Ends every current assignment', name: 'park_ALL.png' }

  async function one(s) { saveBlob(await qrPng(s), s.name) }
  async function all() {
    setBusy(true)
    try {
      const list = kind === 'park' ? [parkAll, ...shown.map(spec)] : shown.map(spec)
      await zipPngs(list, `driveforce_${kind}_${safeName(evName)}.zip`)
    } finally { setBusy(false) }
  }

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
          <button className="btn-sm" onClick={all} disabled={busy || !shown.length}>{busy ? 'Preparing…' : 'Download all PNG (zip)'}</button>
          <button className="btn-primary btn-sm" onClick={() => window.print()}>Print sheet</button>
        </div>
      </div>
      <p className="muted small no-print">{shown.length} codes. PNGs are 1200px wide (about 10cm at 300dpi) with the name printed under the code.</p>

      <div className="qr-sheet">
        {kind === 'park' && (
          <div className="qr-card big" style={{ gridColumn: '1 / -1' }}>
            <QRCodeSVG value={PARK_ALL} size={260} level="M" />
            <div className="name">PARK ALL CARS</div>
            <div className="sub">Ends every current assignment. Keep with the admin.</div>
            <button className="btn-sm no-print" style={{ marginTop: 8 }} onClick={() => one(parkAll)}>PNG</button>
          </div>
        )}
        {shown.map(it => {
          const s = spec(it)
          return (
            <div className={'qr-card' + (kind !== 'drivers' ? ' big' : '')} key={it.id}>
              <QRCodeSVG value={s.value} size={kind !== 'drivers' ? 220 : 150} level="M" />
              <div className="name">{s.title}</div>
              <div className="sub">{s.subtitle}</div>
              {s.footer && <div className="sub" style={{ fontFamily: 'monospace', fontSize: 10 }}>{s.footer}</div>}
              <button className="btn-sm no-print" style={{ marginTop: 8 }} onClick={() => one(s)}>PNG</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
