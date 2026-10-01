/** GIVOVA mark: orange tile with barcode bars (same artwork as the PWA icon). */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="12" fill="#ea580c" />
      <g fill="#fff">
        <rect x="14" y="16" width="4" height="32" />
        <rect x="21" y="16" width="2" height="32" />
        <rect x="26" y="16" width="6" height="32" />
        <rect x="35" y="16" width="2" height="32" />
        <rect x="40" y="16" width="4" height="32" />
        <rect x="47" y="16" width="3" height="32" />
      </g>
    </svg>
  );
}

export function BrandName({ subtitle }: { subtitle?: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[15px] font-extrabold tracking-[0.14em] text-slate-950">GIVOVA</span>
      {subtitle && <span className="text-xs font-medium text-slate-500">{subtitle}</span>}
    </span>
  );
}
