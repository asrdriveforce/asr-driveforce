import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { encodeDriver } from '../lib/codes'
import Logo from './Logo'

// Public page: a driver's personal QR, opened from the link sent to them.
export default function DriverPage() {
  const { code } = useParams()
  const [d, setD] = useState(undefined)

  useEffect(() => {
    supabase.rpc('public_driver', { p_code: code }).then(({ data }) => setD(data?.[0] || null))
  }, [code])

  if (d === undefined) return <div className="login"><p className="muted">Loading…</p></div>
  if (d === null) return <div className="login"><div className="card center"><h1>Code not found</h1><p className="muted">Check the link or ask the event team.</p></div></div>

  return (
    <div className="login">
      <div className="card center stack">
        <div style={{ display: 'flex', justifyContent: 'center' }}><Logo /></div>
        <h1>{d.full_name}</h1>
        {d.event_name && <p className="muted">{d.event_name}</p>}
        <div className="qr-card big" style={{ display: 'inline-block' }}>
          <QRCodeSVG value={encodeDriver(d.code)} size={240} level="M" />
          <div className="sub mono">{d.code}</div>
        </div>
        <p className="muted small">Show this screen to the operator. Turn your brightness up.</p>
        <p className="muted" style={{ fontSize: 11, lineHeight: 1.4, marginTop: 14 }}>Your name and contact details are held by ASR Strategies LLC to record which vehicle you drove and when, to attribute traffic fines and incidents to the responsible driver, and to share that with the event organiser or authorities where required. Data is processed on servers outside the UAE. Contact events@asr.ae to access or correct your details.</p>
      </div>
    </div>
  )
}
