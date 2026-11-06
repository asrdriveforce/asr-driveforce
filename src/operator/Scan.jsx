import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Scanner from '../components/Scanner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { decode, encodeDriver, driverLink } from '../lib/codes'
import { submitScan, startQueueWorker, pendingCount } from '../lib/queue'

const MODES = {
  assign: { title: 'Driver into car', hint1: 'Scan the CAR code', hint2: 'Now scan the DRIVER' },
  checkin: { title: 'Check in', hint1: 'Scan the DRIVER' },
  park: { title: 'Park', hint1: 'Scan a PARK code (car or all)' },
}

// One shared AudioContext, unlocked by the first tap (iOS requires a user gesture before any sound).
let audioCtx = null
function primeAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  } catch { /* ignore */ }
}
function beep(ok = true) {
  try {
    primeAudio()
    const ctx = audioCtx
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.connect(g); g.connect(ctx.destination)
    if (ok) {
      o.frequency.setValueAtTime(1046, t); o.frequency.setValueAtTime(1318, t + 0.08)
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      o.start(t); o.stop(t + 0.18)
    } else {
      o.frequency.setValueAtTime(220, t)
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      o.start(t); o.stop(t + 0.35)
    }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80])
  } catch { /* ignore */ }
}

export default function Scan() {
  const { user, profile } = useAuth()
  const [mode, setMode] = useState('assign')
  const [car, setCar] = useState(null)       // first scan in assign mode
  const [flash, setFlash] = useState(null)   // { kind: 'ok'|'bad'|'warn', text }
  const [paused, setPaused] = useState(false)
  const [pending, setPending] = useState(pendingCount())
  const [event, setEvent] = useState(null)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [newDriver, setNewDriver] = useState(null)
  const busy = useRef(false)

  async function loadEvent() {
    // Most recent non-archived event is the one new records are filed under
    const { data } = await supabase.from('events').select('id,name').eq('archived', false).order('created_at', { ascending: false }).limit(1)
    const e = data?.[0] || null
    setEvent(e)
    return e
  }
  useEffect(() => {
    startQueueWorker(() => setPending(pendingCount()))
    loadEvent()
    const onVis = () => { if (document.visibilityState === 'visible') loadEvent() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  function show(kind, text, ms = 2200) {
    setFlash({ kind, text }); beep(kind === 'ok')
    setPaused(true)
    setTimeout(() => { setFlash(null); setPaused(false) }, ms)
  }

  async function lookup(table, code) {
    const { data } = await supabase.from(table).select('*').eq('code', code).eq('active', true).maybeSingle()
    return data
  }

  async function record(row) {
    const e = await loadEvent().catch(() => event)
    const ok = await submitScan({ ...row, operator_id: user.id, event_id: e?.id || null })
    setPending(pendingCount())
    return ok
  }

  async function onScan(text) {
    if (busy.current || paused) return
    busy.current = true
    try {
      const d = decode(text)
      if (!d) return show('bad', 'Not a DriveForce code')

      // Park codes work from any mode
      if (d.type === 'PA') {
        const ok = await record({ kind: 'park_all' })
        setCar(null)
        return show('ok', ok ? 'ALL CARS PARKED' : 'All parked (queued)', 2600)
      }
      if (d.type === 'PC') {
        const c = await lookup('cars', d.code)
        if (!c) return show('bad', 'Unknown car')
        const ok = await record({ kind: 'park_car', car_id: c.id })
        setCar(null)
        return show('ok', `${c.plate} PARKED${ok ? '' : ' (queued)'}`)
      }

      if (mode === 'checkin') {
        if (d.type !== 'D') return show('warn', 'Scan a driver code')
        const dr = await lookup('drivers', d.code)
        if (!dr) return show('bad', 'Unknown driver')
        const ok = await record({ kind: 'checkin', driver_id: dr.id })
        return show('ok', `${dr.full_name} checked in${ok ? '' : ' (queued)'}`)
      }

      if (mode === 'park') return show('warn', 'That is not a park code')

      // assign mode
      if (d.type === 'C') {
        const c = await lookup('cars', d.code)
        if (!c) return show('bad', 'Unknown car')
        setCar(c); beep(true)
        return
      }
      if (d.type === 'D') {
        if (!car) return show('warn', 'Scan the car first')
        const dr = await lookup('drivers', d.code)
        if (!dr) return show('bad', 'Unknown driver')
        const ok = await record({ kind: 'assign', car_id: car.id, driver_id: dr.id })
        setCar(null)
        return show('ok', `${dr.full_name} → ${car.plate}${ok ? '' : ' (queued)'}`, 2600)
      }
    } finally { busy.current = false }
  }

  function switchMode(m) { primeAudio(); setMode(m); setCar(null); setFlash(null); setShowWalkIn(false); setNewDriver(null) }

  return (
    <div className="stack" onPointerDown={primeAudio}>
      <div className="row between">
        <div><h1>{MODES[mode].title}</h1><div className="muted small">{profile?.full_name} · {event ? event.name : 'No active event'}</div></div>
        {pending > 0 && <span className="badge warn">{pending} queued</span>}
      </div>

      <div className="row between">
        <div className="seg">
          {Object.keys(MODES).map(m => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>{MODES[m].title}</button>
          ))}
        </div>
        <button className="btn-sm" onClick={() => { setShowWalkIn(v => !v); setNewDriver(null) }}>+ Walk-in</button>
      </div>

      {showWalkIn ? (
        <WalkIn event={event} onCreated={(d) => { setNewDriver(d); setShowWalkIn(false) }} onCancel={() => setShowWalkIn(false)} />
      ) : newDriver ? (
        <div className="card center stack">
          <div className="alert ok">Driver added</div>
          <div className="qr-card big" style={{ display: 'inline-block' }}>
            <QRCodeSVG value={encodeDriver(newDriver.code)} size={200} level="M" />
            <div className="name">{newDriver.full_name}</div>
            <div className="sub mono">{newDriver.code}</div>
          </div>
          <p className="muted small">Scan this from another phone, or send the link.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn-sm" onClick={() => navigator.clipboard?.writeText(driverLink(newDriver.code))}>Copy link</button>
            {navigator.share && <button className="btn-sm" onClick={() => navigator.share({ title: 'Your DriveForce code', url: driverLink(newDriver.code) })}>Share</button>}
            <button className="btn-sm btn-primary" onClick={() => setNewDriver(null)}>Back to scanning</button>
          </div>
        </div>
      ) : (
        <>
          {mode === 'assign' && (
            <div className="grid two">
              <div className={'step ' + (car ? 'done' : 'active')}><span className="n">1</span><div><div className="muted small">Car</div><strong>{car ? car.plate : 'Scan car'}</strong></div></div>
              <div className={'step ' + (car ? 'active' : '')}><span className="n">2</span><div><div className="muted small">Driver</div><strong>{car ? 'Scan driver' : 'Waiting'}</strong></div></div>
            </div>
          )}
          {flash && <div className={'alert ' + flash.kind}><div className="big-result">{flash.text}</div></div>}
          <Scanner onScan={onScan} paused={paused} hint={mode === 'assign' && car ? MODES.assign.hint2 : MODES[mode].hint1} />
          {car && <button className="btn-block btn-ghost" onClick={() => setCar(null)}>Cancel car</button>}
        </>
      )}
    </div>
  )
}

function WalkIn({ event, onCreated, onCancel }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await supabase.from('drivers')
      .insert({ full_name: name.trim(), phone: phone.trim(), email: email.trim(), walk_in: true, event_id: event?.id || null })
      .select().single()
    setBusy(false)
    if (error) return setErr(error.message)
    onCreated(data)
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Add walk-in driver</h2>
      {err && <div className="alert bad">{err}</div>}
      <div><label>Full name</label><input value={name} onChange={e => setName(e.target.value)} required autoFocus /></div>
      <div><label>Phone (optional)</label><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" /></div>
      <div><label>Email (optional)</label><input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" /></div>
      <div className="row"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={busy}>Add driver</button></div>
    </form>
  )
}
