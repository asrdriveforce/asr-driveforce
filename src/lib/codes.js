// QR payload format. Every code the app prints is "DF:<type>:<code>".
// type: C = car, D = driver, PC = park this car, PA = park all
export const encodeCar = (code) => `DF:C:${code}`
export const encodeDriver = (code) => `DF:D:${code}`
export const encodeParkCar = (code) => `DF:PC:${code}`
export const encodeEquipment = (code) => `DF:E:${code}`
export const PARK_ALL = 'DF:PA:ALL'

export function decode(text) {
  if (!text) return null
  const t = text.trim()
  // Driver links (yourdomain/d/<code>) also scan as drivers
  const m = t.match(/\/d\/([a-f0-9]{8,})$/i)
  if (m) return { type: 'D', code: m[1] }
  const parts = t.split(':')
  if (parts[0] !== 'DF' || parts.length < 3) return null
  const type = parts[1], code = parts.slice(2).join(':')
  if (!['C', 'D', 'PC', 'PA', 'E'].includes(type)) return null
  return { type, code }
}

export function driverLink(code) {
  return `${window.location.origin}/d/${code}`
}
