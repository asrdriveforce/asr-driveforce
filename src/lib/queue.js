// Local retry queue for scans. Each scan gets a client_id so a retry can never
// create a duplicate (the scans.client_id column is unique).
import { supabase } from './supabase'

const KEY = 'df_scan_queue_v1'

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
function save(q) { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* ignore */ } }

export function pendingCount() { return load().length }

export async function submitScan(row) {
  const payload = { ...row, client_id: row.client_id || crypto.randomUUID(), scanned_at: row.scanned_at || new Date().toISOString() }
  const ok = await tryInsert(payload)
  if (!ok) { const q = load(); q.push(payload); save(q) }
  return ok
}

async function tryInsert(payload) {
  try {
    const { error } = await supabase.from('scans').insert(payload)
    if (!error) return true
    if (error.code === '23505') return true // duplicate client_id: already stored
    return false
  } catch { return false }
}

export async function flushQueue() {
  const q = load()
  if (!q.length) return 0
  const remaining = []
  for (const p of q) { if (!(await tryInsert(p))) remaining.push(p) }
  save(remaining)
  return q.length - remaining.length
}

let timer = null
export function startQueueWorker(onChange) {
  if (timer) return
  const tick = async () => { const n = await flushQueue(); if (n && onChange) onChange() }
  timer = setInterval(tick, 10000)
  window.addEventListener('online', tick)
}
