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
  // Badge logo: 'asr' (bundled), a data URL from an upload, or '' for none. Remembered on this computer.
  const [logo, setLogo] = useState(() => { try { return localStorage.getItem('df_badge_logo') ?? 'asr' } catch { return 'asr' } })
  function chooseLogo(v) { setLogo(v); try { localStorage.setItem('df_badge_logo', v) } catch { /* ignore */ } }
  function onLogoFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader(); reader.onload = () => chooseLogo(String(reader.result)); reader.readAsDataURL(f)
    e.target.value = ''
  }
  const logoSrc = logo === 'asr' ? '/logo.png' : logo

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
    const base = { logo: logoSrc }
    if (kind === 'drivers') return { ...base, value: encodeDriver(it.code), title: it.full_name, subtitle: evName, footer: it.code, name: `driver_${safeName(it.full_name)}_${it.code}.png` }
    if (kind === 'cars') return { ...base, value: encodeCar(it.code), title: it.plate, subtitle: it.label, footer: it.code, name: `car_${safeName(it.plate)}.png` }
    if (kind === 'equipment') return { ...base, value: encodeEquipment(it.code), title: it.name, subtitle: `${it.slots} ${it.slots === 1 ? 'unit' : 'units'}`, footer: it.code, name: `equipment_${safeName(it.name)}.png` }
    return { ...base, value: encodeParkCar(it.code), title: `PARK ${it.plate}`, subtitle: it.label, name: `park_${safeName(it.plate)}.png` }
  }
  const parkAll = { logo: logoSrc, value: PARK_ALL, title: 'PARK ALL CARS', subtitle: 'Ends every current assignment', name: 'park_ALL.png' }

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
      <div className="card row no-print" style={{ padding: '10px 14px' }}>
        <span className="small muted">Badge logo</span>
        <div className="seg">
          <button className={logo === 'asr' ? 'on' : ''} onClick={() => chooseLogo('asr')}>ASR</button>
          <button className={logo && logo !== 'asr' ? 'on' : ''} onClick={() => document.getElementById('badge-logo-file').click()}>Upload…</button>
          <button className={!logo ? 'on' : ''} onClick={() => chooseLogo('')}>None</button>
        </div>
        <input id="badge-logo-file" type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} onChange={onLogoFile} />
        {logoSrc && <img src={logoSrc} alt="" style={{ height: 28, width: 'auto', marginLeft: 6 }} />}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{shown.length} codes · PNGs 1200px wide (≈10cm at 300dpi)</span>
      </div>

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
              {logoSrc && <img src={logoSrc} alt="" style={{ height: kind === 'drivers' ? 22 : 30, width: 'auto', margin: '0 auto 8px', display: 'block' }} />}
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
