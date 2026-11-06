import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase, configured } from './lib/supabase'
import Login from './components/Login'
import DriverPage from './components/DriverPage'
import Scan from './operator/Scan'
import Dashboard from './admin/Dashboard'
import Search from './admin/Search'
import Events from './admin/Events'
import Cars from './admin/Cars'
import Drivers from './admin/Drivers'
import Operators from './admin/Operators'
import Records from './admin/Records'
import Attendance from './admin/Attendance'
import PrintSheet from './admin/PrintSheet'

function NotConfigured() {
  return (
    <div className="login"><div className="card">
      <h1>ASR DriveForce</h1>
      <p className="muted">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
    </div></div>
  )
}

function Shell({ children, admin }) {
  const { profile } = useAuth()
  const nav = useNavigate()
  async function logout() { await supabase.auth.signOut(); nav('/login') }
  return (
    <div className={'app' + (admin ? '' : ' narrow')}>
      <div className="topbar no-print">
        <div className="brand"><span className="dot" /> DriveForce</div>
        <div className="row">
          {profile?.role === 'admin' && !admin && <nav className="nav"><NavLink to="/admin">Admin</NavLink></nav>}
          {profile?.role === 'admin' && admin && (
            <nav className="nav">
              <NavLink to="/scan">Scan</NavLink>
              <NavLink to="/admin" end>Dashboard</NavLink>
              <NavLink to="/admin/search">Search</NavLink>
              <NavLink to="/admin/records">Records</NavLink>
              <NavLink to="/admin/attendance">Attendance</NavLink>
              <NavLink to="/admin/events">Events</NavLink>
              <NavLink to="/admin/cars">Cars</NavLink>
              <NavLink to="/admin/drivers">Drivers</NavLink>
              <NavLink to="/admin/operators">Operators</NavLink>
            </nav>
          )}
          <button className="btn-sm btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
      {children}
    </div>
  )
}

function RequireAuth({ children, adminOnly }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>
  if (!user) return <Navigate to="/login" replace />
  if (!profile) return <div className="login"><div className="card"><p>Your account has no profile yet. Ask the admin to set it up.</p></div></div>
  if (!profile.active) return <div className="login"><div className="card"><p>This account has been deactivated.</p></div></div>
  if (adminOnly && profile.role !== 'admin') return <Navigate to="/scan" replace />
  return children
}

function Home() {
  const { profile } = useAuth()
  return <Navigate to={profile?.role === 'admin' ? '/admin' : '/scan'} replace />
}

export default function App() {
  if (!configured) return <NotConfigured />
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/d/:code" element={<DriverPage />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/scan" element={<RequireAuth><Shell><Scan /></Shell></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth adminOnly><Shell admin><Dashboard /></Shell></RequireAuth>} />
        <Route path="/admin/search" element={<RequireAuth adminOnly><Shell admin><Search /></Shell></RequireAuth>} />
        <Route path="/admin/records" element={<RequireAuth adminOnly><Shell admin><Records /></Shell></RequireAuth>} />
        <Route path="/admin/attendance" element={<RequireAuth adminOnly><Shell admin><Attendance /></Shell></RequireAuth>} />
        <Route path="/admin/events" element={<RequireAuth adminOnly><Shell admin><Events /></Shell></RequireAuth>} />
        <Route path="/admin/cars" element={<RequireAuth adminOnly><Shell admin><Cars /></Shell></RequireAuth>} />
        <Route path="/admin/drivers" element={<RequireAuth adminOnly><Shell admin><Drivers /></Shell></RequireAuth>} />
        <Route path="/admin/operators" element={<RequireAuth adminOnly><Shell admin><Operators /></Shell></RequireAuth>} />
        <Route path="/admin/print/:kind" element={<RequireAuth adminOnly><Shell admin><PrintSheet /></Shell></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
