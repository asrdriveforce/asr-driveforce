import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import Logo from './Logo'

export default function Login() {
  const { user, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(error.message); else nav('/')
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <Logo size={40} />
        <h1 style={{ marginTop: 18 }}>Sign in</h1>
        {err && <div className="alert bad">{err}</div>}
        <div><label>Email</label><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div><label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
        <button className="btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
