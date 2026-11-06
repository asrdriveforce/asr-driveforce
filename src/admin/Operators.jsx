import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Accounts are created in the Supabase dashboard (Authentication → Users → Add user).
// This page sets their name, role and active flag.
export default function Operators() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')

  async function load() {
    const { data, error } = await supabase.from('operators').select('*').order('created_at')
    if (error) setErr(error.message); else setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function update(id, patch) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setErr(error.message); else load()
  }
  function rename(r) { const n = window.prompt('Display name', r.full_name); if (n !== null) update(r.id, { full_name: n.trim() }) }

  return (
    <div>
      <h1>Operators</h1>
      <div className="card">
        <p className="muted small">To add an operator: in Supabase go to Authentication → Users → Add user → Create new user, enter their email and a password, tick "Auto Confirm User", and create. They then appear here as an operator. Set their display name below (it's what shows on scan records).</p>
        {err && <div className="alert bad">{err}</div>}
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} style={{ opacity: r.active ? 1 : .5 }}>
              <td><strong>{r.full_name || <span className="muted">(no name)</span>}</strong>{r.id === user.id && <span className="badge accent" style={{ marginLeft: 6 }}>you</span>}</td>
              <td className="muted">{r.email}</td>
              <td>
                <select value={r.role} disabled={r.id === user.id} style={{ width: 'auto' }} onChange={e => update(r.id, { role: e.target.value })}>
                  <option value="operator">Operator</option><option value="admin">Admin</option>
                </select>
              </td>
              <td>{r.active ? <span className="badge ok">Active</span> : <span className="badge bad">Deactivated</span>}</td>
              <td className="row">
                <button className="btn-sm btn-ghost" onClick={() => rename(r)}>Rename</button>
                {r.id !== user.id && <button className="btn-sm btn-ghost" onClick={() => update(r.id, { active: !r.active })}>{r.active ? 'Deactivate' : 'Reactivate'}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
