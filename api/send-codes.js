// Vercel serverless function: emails each selected driver their personal QR code and link.
// Only admins may call it. Requires env: RESEND_API_KEY, MAIL_FROM (e.g. "ASR DriveForce <drivers@asr.ae>"),
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
import { Resend } from 'resend'
import QRCode from 'qrcode'

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY

async function sb(path, token, init = {}) {
  const r = await fetch(`${SB_URL}${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'Not signed in' })
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return res.status(500).json({ error: 'Email not configured (RESEND_API_KEY / MAIL_FROM)' })

    // Who is calling, and are they admin? (RLS applies, so this only returns their own row unless admin)
    const user = await sb('/auth/v1/user', token)
    const prof = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=role,active`, token)
    if (!prof[0] || prof[0].role !== 'admin' || !prof[0].active) return res.status(403).json({ error: 'Admins only' })

    const { driver_ids, event_name, origin, subject, intro } = req.body || {}
    if (!Array.isArray(driver_ids) || !driver_ids.length) return res.status(400).json({ error: 'No drivers selected' })
    const ids = driver_ids.slice(0, 500).map(s => `"${String(s).replace(/[^0-9a-f-]/gi, '')}"`).join(',')
    const drivers = await sb(`/rest/v1/drivers?id=in.(${ids})&active=eq.true&select=id,full_name,email,code`, token)

    const resend = new Resend(process.env.RESEND_API_KEY)
    const base = String(origin || '').replace(/\/$/, '')
    const results = []
    for (const d of drivers) {
      if (!d.email) { results.push({ id: d.id, name: d.full_name, ok: false, error: 'no email' }); continue }
      const link = `${base}/d/${d.code}`
      const png = await QRCode.toBuffer(`DF:D:${d.code}`, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
      const html = `
        <div style="font-family:'Avenir Next',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="margin:0 0 8px">${esc(event_name || 'Your driver code')}</h2>
          <p>Hi ${esc(d.full_name)},</p>
          <p>${esc(intro || 'Here is your personal driver code. Show it to the operator when you check in and when you get into a car. The attached image works too.')}</p>
          <p style="text-align:center;margin:24px 0"><img src="cid:qr" alt="QR code" width="260" height="260" style="border:1px solid #ddd;border-radius:8px"></p>
          <p style="text-align:center"><a href="${link}" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Open my code</a></p>
          <p style="color:#666;font-size:13px">Link: <a href="${link}">${link}</a><br>Code: ${d.code}</p>
          <p style="color:#888;font-size:11px;line-height:1.4;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Your name and contact details are held by ASR Strategies LLC to record which vehicle you drove and when, to attribute traffic fines and incidents to the responsible driver, and to share that with the event organiser or authorities where required. Data is processed on servers outside the UAE. Reply to this email to access or correct your details.</p>
        </div>`
      try {
        const { error } = await resend.emails.send({
          from: process.env.MAIL_FROM,
          to: d.email,
          subject: subject || `Your driver code${event_name ? ' – ' + event_name : ''}`,
          html,
          attachments: [{ filename: `driver-code-${d.code}.png`, content: png, contentId: 'qr' }],
        })
        results.push({ id: d.id, name: d.full_name, ok: !error, error: error?.message })
      } catch (e) {
        results.push({ id: d.id, name: d.full_name, ok: false, error: String(e.message || e) })
      }
    }
    return res.status(200).json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), total: results.length })
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) })
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
