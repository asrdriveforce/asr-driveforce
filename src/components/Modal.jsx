import { useEffect } from 'react'

export default function Modal({ title, children, onClose, footer }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="btn-sm btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// Small helper for "ask for a value" dialogs that used to be window.prompt
export function FormModal({ title, fields, initial = {}, onSubmit, onClose, submitLabel = 'Save', danger }) {
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); onSubmit(Object.fromEntries(fd.entries())) }}>
        {fields.map(f => (
          <div key={f.name}>
            <label>{f.label}</label>
            {f.type === 'textarea'
              ? <textarea name={f.name} defaultValue={initial[f.name] || ''} rows={3} required={f.required} placeholder={f.placeholder} autoFocus={f.autoFocus} />
              : <input name={f.name} type={f.type || 'text'} defaultValue={initial[f.name] || ''} required={f.required} placeholder={f.placeholder} autoFocus={f.autoFocus} />}
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn-danger-solid' : 'btn-primary'}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

export function ConfirmModal({ title, message, onConfirm, onClose, confirmLabel = 'Delete' }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-danger-solid" onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </Modal>
  )
}
