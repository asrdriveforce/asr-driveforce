// ASR mark (3x3 grid) rebuilt as vector from the supplied logo.
export const MARK_COLORS = [
  ['#F5E35A', '#D5D5D6', '#EEEFF0'],
  ['#EE9A37', '#F5E35A', '#D5D5D6'],
  ['#D83C27', '#EE9A37', '#F5E35A'],
]

export function Mark({ size = 28 }) {
  const cell = 100 / 3
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      <defs><clipPath id="asr-clip"><rect width="100" height="100" rx="18" /></clipPath></defs>
      <g clipPath="url(#asr-clip)">
        {MARK_COLORS.map((row, r) => row.map((c, i) => (
          <rect key={r + '-' + i} x={i * cell} y={r * cell} width={cell + .5} height={cell + .5} fill={c} />
        )))}
      </g>
    </svg>
  )
}

export default function Logo({ size = 28, product = true }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="logo-word" style={{ fontSize: size * 0.8 }}>ASR</span>
      {product && <span className="logo-product" style={{ fontSize: size * 0.5 }}>DriveForce</span>}
    </span>
  )
}
