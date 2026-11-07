import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { supabase, configured } from './lib/supabase'
import Logo from './components/Logo'
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
import Fines from './admin/Fines'
import Equipment from './admin/Equipment'

function NotConfigured() {
  return (
    <div className="login"><div className="card">
      <Logo />
      <p className="muted" style={{ marginTop: 12 }}>Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
    </div></div>
  )
}

function Shell({ children, admin }) {
  const { profile } = useAuth()
  const nav = useNavigate()
  async function logout() { await supabase.auth.signOut(); nav('/login') }
  const isAdmin = profile?.role === 'admin'
  return (
    <div className={'app' + (admin ? '' : ' narrow')}>
      <div className="topbar no-print">
        <NavLink to="/" style={{ textDecoration: 'none' }}><Logo /></NavLink>
        {!admin && (
          <div className="topbar-right">
            {isAdmin && <NavLink className="btn btn-sm" to="/admin">Admin</NavLink>}
            <button className="btn-sm btn-ghost" onClick={logout}>Log out</button>
          </div>
        )}
        {isAdmin && admin && (
          <nav className="nav">
            <NavLink to="/scan">Scan</NavLink>
            <NavLink to="/admin" end>Dashboard</NavLink>
            <NavLink to="/admin/search">Search</NavLink>
            <NavLink to="/admin/records">Records</NavLink>
            <NavLink to="/admin/attendance">Attendance</NavLink>
            <NavLink to="/admin/fines">Fines</NavLink>
            <NavLink to="/admin/events">Events</NavLink>
            <NavLink to="/admin/cars">Cars</NavLink>
            <NavLink to="/admin/drivers">Drivers</NavLink>
            <NavLink to="/admin/equipment">Equipment</NavLink>
            <NavLink to="/admin/operators">Operators</NavLink>
          </nav>
        )}
      </div>
      {children}
      {admin && (
        <div className="footer no-print">
          <span className="user-chip">{profile?.full_name}</span>
          <button className="btn-sm btn-ghost" onClick={logout}>Log out</button>
        </div>
      )}
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
  const A = (el) => <RequireAuth adminOnly><Shell admin>{el}</Shell></RequireAuth>
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/d/:code" element={<DriverPage />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/scan" element={<RequireAuth><Shell><Scan /></Shell></RequireAuth>} />
        <Route path="/admin" element={A(<Dashboard />)} />
        <Route path="/admin/search" element={A(<Search />)} />
        <Route path="/admin/records" element={A(<Records />)} />
        <Route path="/admin/attendance" element={A(<Attendance />)} />
        <Route path="/admin/fines" element={A(<Fines />)} />
        <Route path="/admin/events" element={A(<Events />)} />
        <Route path="/admin/cars" element={A(<Cars />)} />
        <Route path="/admin/drivers" element={A(<Drivers />)} />
        <Route path="/admin/equipment" element={A(<Equipment />)} />
        <Route path="/admin/operators" element={A(<Operators />)} />
        <Route path="/admin/devices" element={<Navigate to="/admin/equipment?tab=phones" replace />} />
        <Route path="/admin/print/:kind" element={A(<PrintSheet />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
