// Local retry queue for scans. Each scan gets a client_id so a retry can never
// create a duplicate (the scans.client_id column is unique).
import { supabase } from './supabase'

const KEY = 'df_scan_queue_v1'

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
function save(q) { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* ignore */ } }

export function pendingCount() { return load().length }

export async function submitScan(row, table = 'scans') {
  const payload = { ...row, _table: table, client_id: row.client_id || crypto.randomUUID(), scanned_at: row.scanned_at || new Date().toISOString() }
  const r = await tryInsert(payload)
  if (!r.ok && !r.reason) { const q = load(); q.push(payload); save(q) }   // network trouble: queue; a refusal is final
  return r
}

// Returns { ok } on success, { ok:false, reason } when the database refused it, { ok:false } on network failure.
async function tryInsert(payload) {
  try {
    const { _table, ...row } = payload
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000)
    const { error } = await supabase.from(_table || 'scans').insert(row).abortSignal(ctrl.signal)
    clearTimeout(t)
    if (!error) return { ok: true }
    if (error.code === '23505') return { ok: true } // duplicate client_id: already stored
    const m = String(error.message || '').match(/^(NOT_LIVE|NO_EVENT)/)
    if (m) return { ok: false, reason: m[1] }
    if (error.code && error.code !== 'PGRST301' && !/fetch|network|abort/i.test(error.message || '')) return { ok: false, reason: 'REJECTED', message: error.message }
    return { ok: false }
  } catch { return { ok: false } }
}

export async function flushQueue() {
  const q = load()
  if (!q.length) return 0
  const remaining = []
  for (const p of q) { const r = await tryInsert(p); if (!r.ok && !r.reason) remaining.push(p) }
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
