// ASR logo: the supplied artwork (public/logo.png) plus the product name.
export default function Logo({ size = 28, product = true }) {
  return (
    <span className="logo">
      <img src="/logo.png" alt="ASR" style={{ height: size, width: 'auto', display: 'block' }} />
      {product && <span className="logo-product" style={{ fontSize: Math.round(size * 0.5) }}>DriveForce</span>}
    </span>
  )
}
