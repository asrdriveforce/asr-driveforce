import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext({ user: null, profile: null, loading: true })

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function loadProfile(u) {
      if (!u) { setProfile(null); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', u.id).single()
      if (alive) setProfile(data || null)
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user || null
      setUser(u); await loadProfile(u); if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const u = session?.user || null
      setUser(u); await loadProfile(u)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  return <AuthCtx.Provider value={{ user, profile, loading }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
