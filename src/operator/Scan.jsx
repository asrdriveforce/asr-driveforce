import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Scanner from '../components/Scanner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { decode, encodeDriver, driverLink } from '../lib/codes'
import { submitScan, startQueueWorker, pendingCount } from '../lib/queue'

const MODES = {
  assign: { title: 'Driver into car', label: 'Car', hint1: 'Scan the CAR code', hint2: 'Now scan the DRIVER' },
  checkin: { title: 'Check in', label: 'Check in', hint1: 'Scan the DRIVER' },
  park: { title: 'Park', label: 'Park', hint1: 'Scan the CAR to park it' },
  issue: { title: 'Issue equipment', label: 'Issue', hint1: 'Scan the EQUIPMENT code', hint2: 'Now scan the PERSON' },
  ret: { title: 'Return equipment', label: 'Return', hint1: 'Scan the EQUIPMENT code' },
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
  const [item, setItem] = useState(null)     // first scan in issue mode
  const [returning, setReturning] = useState(null) // { item, back: Set<slot> } while the return screen is open
  const [flash, setFlash] = useState(null)   // { kind: 'ok'|'bad'|'warn', text }
  const [paused, setPaused] = useState(false)
  const [pending, setPending] = useState(pendingCount())
  const [event, setEvent] = useState(null)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [newDriver, setNewDriver] = useState(null)
  const busy = useRef(false)
  const recent = useRef({ text: '', until: 0 })   // ignore a just-processed code for a few seconds

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

  async function alreadyCheckedInToday(driverId) {
    const { data } = await supabase.rpc('checkin_time_today', { p_driver: driverId })
    if (!data) return null
    return new Date(data).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })
  }
  async function lookup(table, code) {
    if (table === 'drivers') {
      // operators can't read the drivers table; this returns id, name and code only
      const { data } = await supabase.rpc('driver_by_code', { p_code: code })
      return data?.[0] || null
    }
    const { data } = await supabase.from(table).select('*').eq('code', code).eq('active', true).maybeSingle()
    return data
  }

  // Never let a slow network freeze the screen: after 6s the scan is queued and retried in the background.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise(res => setTimeout(() => res(fallback), ms))])
  }
  async function record(row, table = 'scans') {
    const e = await withTimeout(loadEvent().catch(() => event), 3000, event)
    const ok = await withTimeout(submitScan({ ...row, operator_id: user.id, event_id: e?.id || null }, table), 6000, false)
    setPending(pendingCount())
    return ok
  }
  async function lookupEquipment(code) {
    const { data } = await supabase.rpc('equipment_by_code', { p_code: code })
    return data?.[0] || null
  }

  function done(text) { recent.current = { text, until: Date.now() + 6000 } }
  async function onScan(text) {
    if (busy.current || paused) return
    if (text === recent.current.text && Date.now() < recent.current.until) return
    busy.current = true
    try {
      const d = decode(text)
      if (!d) return show('bad', 'Not a DriveForce code')

      // Park codes work from any mode
      if (d.type === 'PA') {
        const ok = await record({ kind: 'park_all' })
        done(text); setCar(null)
        return show('ok', ok ? 'ALL CARS PARKED' : 'All parked (queued)', 2600)
      }
      if (d.type === 'PC') {
        const c = await lookup('cars', d.code)
        if (!c) return show('bad', 'Unknown car')
        const ok = await record({ kind: 'park_car', car_id: c.id })
        done(text); setCar(null)
        return show('ok', `${c.plate} PARKED${ok ? '' : ' (queued)'}`)
      }

      if (mode === 'checkin') {
        if (d.type !== 'D') return show('warn', 'Scan a driver code')
        const dr = await lookup('drivers', d.code)
        if (!dr) return show('bad', 'Unknown driver')
        const prior = await alreadyCheckedInToday(dr.id)
        if (prior) { done(text); return show('warn', `${dr.full_name} already checked in at ${prior}`) }
        const ok = await record({ kind: 'checkin', driver_id: dr.id })
        done(text)
        return show('ok', `${dr.full_name} checked in${ok ? '' : ' (queued)'}`)
      }

      if (mode === 'issue') {
        if (d.type === 'E') {
          const it = await lookupEquipment(d.code)
          if (!it) return show('bad', 'Unknown equipment')
          setItem(it); beep(true); done(text)
          return
        }
        if (d.type !== 'D') return show('warn', item ? 'Scan the person' : 'Scan the equipment first')
        if (!item) return show('warn', 'Scan the equipment first')
        const dr = await lookup('drivers', d.code)
        if (!dr) return show('bad', 'Unknown person')
        const ok = await record({ kind: 'issue', equipment_id: item.id, driver_id: dr.id }, 'equipment_events')
        done(text); setItem(null)
        return show('ok', `${item.name} → ${dr.full_name}${ok ? '' : ' (queued)'}`, 2600)
      }

      if (mode === 'ret') {
        if (d.type !== 'E') return show('warn', 'Scan an equipment code')
        const it = await lookupEquipment(d.code)
        if (!it) return show('bad', 'Unknown equipment')
        if (!it.issued_at) { done(text); return show('warn', `${it.name} is not issued to anyone`) }
        if (!it.missing_slots?.length) { done(text); return show('warn', `${it.name} already fully returned`) }
        done(text); beep(true)
        setReturning({ item: it, back: new Set(it.missing_slots) })
        setPaused(true)
        return
      }

      if (mode === 'park') {
        if (d.type !== 'C') return show('warn', 'Scan a car code')
        const c = await lookup('cars', d.code)
        if (!c) return show('bad', 'Unknown car')
        const ok = await record({ kind: 'park_car', car_id: c.id })
        done(text); setCar(null)
        return show('ok', `${c.plate} PARKED${ok ? '' : ' (queued)'}`)
      }

      // assign mode
      if (d.type === 'C') {
        const c = await lookup('cars', d.code)
        if (!c) return show('bad', 'Unknown car')
        setCar(c); beep(true); done(text)
        return
      }
      if (d.type === 'D') {
        if (!car) return show('warn', 'Scan the car first')
        const dr = await lookup('drivers', d.code)
        if (!dr) return show('bad', 'Unknown driver')
        const ok = await record({ kind: 'assign', car_id: car.id, driver_id: dr.id })
        done(text); setCar(null)
        return show('ok', `${dr.full_name} → ${car.plate}${ok ? '' : ' (queued)'}`, 2600)
      }
    } finally { busy.current = false }
  }

  function switchMode(m) { primeAudio(); setMode(m); setCar(null); setItem(null); setReturning(null); setPaused(false); setFlash(null); setShowWalkIn(false); setNewDriver(null) }

  async function confirmReturn() {
    const { item: it, back } = returning
    const slots = [...back].sort((a, b) => a - b)
    const missing = it.missing_slots.filter(n => !back.has(n))
    const ok = await record({ kind: 'return', equipment_id: it.id, slots }, 'equipment_events')
    setReturning(null); setPaused(false)
    if (!slots.length) return show('warn', `${it.name}: nothing returned`)
    show(missing.length ? 'warn' : 'ok', `${it.name}: ${missing.length ? `MISSING ${missing.join(', ')}` : 'all returned'}${ok ? '' : ' (queued)'}`, 3000)
  }

  return (
    <div className="stack" onPointerDown={primeAudio}>
      <div className="row between">
        <div><h1>{MODES[mode].title}</h1><div className="muted small">{profile?.full_name} · {event ? event.name : 'No active event'}</div></div>
        {pending > 0 && <span className="badge warn">{pending} queued</span>}
      </div>

      <div className="row between">
        <div className="seg">
          {Object.keys(MODES).map(m => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>{MODES[m].label}</button>
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
      ) : returning ? (
        <div className="card stack">
          <h2>{returning.item.name}</h2>
          <p className="muted small">Issued to {returning.item.holder_name}. Tap any item that did NOT come back.</p>
          <div className="slots">
            {returning.item.missing_slots.map(n => (
              <button key={n} className={'slot ' + (returning.back.has(n) ? 'back' : 'missing')}
                onClick={() => setReturning(r => { const b = new Set(r.back); b.has(n) ? b.delete(n) : b.add(n); return { ...r, back: b } })}>
                {n}
              </button>
            ))}
          </div>
          <div className="row between">
            <button className="btn-ghost" onClick={() => { setReturning(null); setPaused(false) }}>Cancel</button>
            <button className="btn-primary" onClick={confirmReturn}>
              {returning.back.size === returning.item.missing_slots.length ? 'All returned' : `Confirm (${returning.item.missing_slots.length - returning.back.size} missing)`}
            </button>
          </div>
        </div>
      ) : (
        <>
          {mode === 'issue' && (
            <div className="grid two">
              <div className={'step ' + (item ? 'done' : 'active')}><span className="n">1</span><div><div className="muted small">Equipment</div><strong>{item ? item.name : 'Scan item'}</strong>{item?.missing_slots?.length > 0 && <div className="small muted">currently with {item.holder_name}</div>}</div></div>
              <div className={'step ' + (item ? 'active' : '')}><span className="n">2</span><div><div className="muted small">Person</div><strong>{item ? 'Scan badge' : 'Waiting'}</strong></div></div>
            </div>
          )}
          {mode === 'assign' && (
            <div className="grid two">
              <div className={'step ' + (car ? 'done' : 'active')}><span className="n">1</span><div><div className="muted small">Car</div><strong>{car ? car.plate : 'Scan car'}</strong></div></div>
              <div className={'step ' + (car ? 'active' : '')}><span className="n">2</span><div><div className="muted small">Driver</div><strong>{car ? 'Scan driver' : 'Waiting'}</strong></div></div>
            </div>
          )}
          {flash && <div className={'alert ' + flash.kind}><div className="big-result">{flash.text}</div></div>}
          <Scanner onScan={onScan} paused={paused} hint={flash ? flash.text : ((mode === 'assign' && car) || (mode === 'issue' && item) ? MODES[mode].hint2 : MODES[mode].hint1)} />
          {car && <button className="btn-block btn-ghost" onClick={() => setCar(null)}>Cancel car</button>}
          {item && <button className="btn-block btn-ghost" onClick={() => setItem(null)}>Cancel item</button>}
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
    // Operators can insert but not read the drivers table, so the code is generated here and returned as-is.
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('')
    const row = { full_name: name.trim(), phone: phone.trim(), email: email.trim(), walk_in: true, event_id: event?.id || null, code }
    const { error } = await supabase.from('drivers').insert(row)
    setBusy(false)
    if (error) return setErr(error.message)
    onCreated(row)
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
