export const TZ = 'Asia/Dubai'

export function fmt(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function fmtFull(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
export function fmtDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' })
}
// 'YYYY-MM-DD' in Dubai time for grouping by day
export function dayKey(ts) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts))
  const g = (t) => p.find(x => x.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}`
}
// datetime-local value (interpreted as Dubai time) -> ISO
export function localToIso(v) {
  if (!v) return null
  return new Date(v + ':00+04:00').toISOString()
}
export function nowLocal() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const g = (t) => p.find(x => x.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}
export function csv(rows, cols) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  return [cols.map(c => c.label).join(','), ...rows.map(r => cols.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n')
}
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
