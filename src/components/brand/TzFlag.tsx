/**
 * Tanzania national flag, correct 2:3 proportions.
 * Green upper-hoist triangle, blue lower-fly triangle, black diagonal band
 * bordered in yellow running from lower hoist to upper fly.
 * Official colours are used intentionally (flag fidelity), not theme tokens.
 */
export function TzFlag({ className = "h-5 w-auto", title = "Bendera ya Tanzania" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 72 48" className={className} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      <title>{title}</title>
      <defs>
        <clipPath id="tzclip"><rect width="72" height="48" /></clipPath>
      </defs>
      <g clipPath="url(#tzclip)">
        <rect width="72" height="48" fill="#00A3DD" />
        <polygon points="0,0 72,0 0,48" fill="#1EB53A" />
        <line x1="0" y1="48" x2="72" y2="0" stroke="#FCD116" strokeWidth="19" />
        <line x1="0" y1="48" x2="72" y2="0" stroke="#000000" strokeWidth="13" />
      </g>
    </svg>
  );
}
