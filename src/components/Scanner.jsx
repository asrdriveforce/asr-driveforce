import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

// Camera QR scanner. Calls onScan(text) once per distinct code; the same code
// is ignored for `cooldownMs` so a steady hand doesn't fire twice.
export default function Scanner({ onScan, hint, paused, cooldownMs = 2500 }) {
  const ref = useRef(null)
  const last = useRef({ text: '', at: 0 })
  const cb = useRef(onScan)
  cb.current = onScan
  const [err, setErr] = useState('')

  useEffect(() => {
    const qr = new Html5Qrcode('df-reader', { verbose: false })
    ref.current = qr
    let started = false
    qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s } }, aspectRatio: 1 },
      (text) => {
        const now = Date.now()
        if (text === last.current.text && now - last.current.at < cooldownMs) return
        last.current = { text, at: now }
        cb.current(text)
      },
      () => {}
    ).then(() => { started = true }).catch((e) => { setErr(String(e?.message || e)) })
    return () => {
      if (!started) return
      try { qr.stop().then(() => qr.clear()).catch(() => {}) } catch { /* not running */ }
    }
  }, [cooldownMs])

  useEffect(() => {
    const qr = ref.current
    if (!qr) return
    try { if (paused) qr.pause(true); else qr.resume() } catch { /* not started yet */ }
  }, [paused])

  return (
    <div className="scanner">
      <div id="df-reader" />
      <div className="overlay"><div className="hint">{err ? 'Camera unavailable: ' + err : hint}</div></div>
    </div>
  )
}
