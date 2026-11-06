import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { format, parse, isValid } from 'date-fns'
import 'react-day-picker/style.css'

// Date-only picker. value/onChange use 'YYYY-MM-DD' strings (or '').
export function DatePicker({ value, onChange, placeholder = 'Pick a date', allowClear = true, style }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  const date = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined
  return (
    <div className="dp" ref={ref} style={style}>
      <button type="button" className="dp-btn" onClick={() => setOpen(o => !o)}>
        <CalIcon />
        <span className={value ? '' : 'muted'}>{date && isValid(date) ? format(date, 'EEE d MMM yyyy') : placeholder}</span>
        {allowClear && value && <span className="dp-clear" onClick={(e) => { e.stopPropagation(); onChange('') }} aria-label="Clear">✕</span>}
      </button>
      {open && (
        <div className="dp-pop">
          <DayPicker mode="single" selected={date} defaultMonth={date} weekStartsOn={1} showOutsideDays
            onSelect={(d) => { onChange(d ? format(d, 'yyyy-MM-dd') : ''); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

// Date + time picker. value/onChange use 'YYYY-MM-DDTHH:mm' strings (local/Dubai time).
export function DateTimePicker({ value, onChange, style }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(ref, () => setOpen(false))
  const [datePart, timePart] = value ? value.split('T') : ['', '12:00']
  const date = datePart ? parse(datePart, 'yyyy-MM-dd', new Date()) : undefined
  const [hh, mm] = (timePart || '12:00').split(':')
  const set = (d, t) => onChange(`${d || format(new Date(), 'yyyy-MM-dd')}T${t}`)
  return (
    <div className="dp" ref={ref} style={style}>
      <button type="button" className="dp-btn" onClick={() => setOpen(o => !o)}>
        <CalIcon />
        <span>{date && isValid(date) ? format(date, 'EEE d MMM yyyy') : 'Pick a date'}</span>
        <span className="dp-time">{timePart || '12:00'}</span>
      </button>
      {open && (
        <div className="dp-pop">
          <DayPicker mode="single" selected={date} defaultMonth={date} weekStartsOn={1} showOutsideDays
            onSelect={(d) => { if (d) set(format(d, 'yyyy-MM-dd'), timePart || '12:00') }} />
          <div className="dp-timerow">
            <label>Time</label>
            <select value={hh} onChange={e => set(datePart, `${e.target.value}:${mm}`)}>
              {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span>:</span>
            <select value={mm} onChange={e => set(datePart, `${hh}:${e.target.value}`)}>
              {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" className="btn-sm" onClick={() => { onChange(nowLocalStr()); setOpen(false) }}>Now</button>
            <button type="button" className="btn-sm btn-primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function nowLocalStr() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const g = (t) => p.find(x => x.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

function useOutside(ref, fn) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn() }
    document.addEventListener('mousedown', h); document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [ref, fn])
}

function CalIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
}
