import QRCode from 'qrcode'
import JSZip from 'jszip'

// Render a print-ready PNG: QR plus title/subtitle, 1200px wide (≈100mm at 300dpi).
const logoCache = {}
function loadImage(src) {
  if (!src) return Promise.resolve(null)
  if (logoCache[src]) return Promise.resolve(logoCache[src])
  return new Promise((res) => { const im = new Image(); im.onload = () => { logoCache[src] = im; res(im) }; im.onerror = () => res(null); im.src = src })
}

export async function qrPng({ value, title, subtitle = '', footer = '', logo = null }) {
  const W = 1200, pad = 80
  const img = await loadImage(logo)
  const qrSize = img ? 820 : W - pad * 2            // smaller code when a logo shares the badge
  const qrX = Math.round((W - qrSize) / 2)
  const logoH = img ? Math.min(150, Math.round(img.height * Math.min(1, (W - pad * 2) / img.width))) : 0
  const logoBlock = img ? logoH + 90 : 0
  const titleH = 150, subH = subtitle ? 70 : 0, footH = footer ? 50 : 0
  const H = pad + logoBlock + qrSize + 40 + titleH + subH + footH + pad / 2
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  if (img) {
    const lw = Math.round(img.width * (logoH / img.height))
    ctx.drawImage(img, Math.round((W - lw) / 2), pad, lw, logoH)
  }
  const q = document.createElement('canvas')
  await QRCode.toCanvas(q, value, { width: qrSize, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
  ctx.drawImage(q, qrX, pad + logoBlock)
  ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  let y = pad + logoBlock + qrSize + 40
  ctx.font = 'bold 110px Avenir Next, Helvetica, Arial, sans-serif'
  fitText(ctx, title, W - pad * 2, 110); ctx.fillText(title, W / 2, y); y += titleH
  if (subtitle) { ctx.font = '52px Avenir Next, Helvetica, Arial, sans-serif'; ctx.fillStyle = '#333'; fitText(ctx, subtitle, W - pad * 2, 52); ctx.fillText(subtitle, W / 2, y); y += subH }
  if (footer) { ctx.font = '36px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#666'; ctx.fillText(footer, W / 2, y) }
  return new Promise(res => c.toBlob(res, 'image/png'))
}

function fitText(ctx, text, maxW, startPx) {
  let px = startPx
  while (ctx.measureText(text).width > maxW && px > 20) { px -= 4; ctx.font = ctx.font.replace(/\d+px/, px + 'px') }
}

export function safeName(s) { return String(s).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'code' }

export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export async function zipPngs(items, zipName) {
  const zip = new JSZip()
  for (const it of items) zip.file(it.name, await qrPng(it))
  saveBlob(await zip.generateAsync({ type: 'blob' }), zipName)
}
