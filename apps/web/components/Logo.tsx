"use client";

/** slidr mark: a spotlight play button on a dot grid. */
export function Logo({ size = 44 }: { size?: number }) {
  const dots: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      // Leave room for the play triangle in the middle.
      if (r >= 1 && r <= 2 && c >= 1 && c <= 2) continue;
      dots.push(<circle key={`${r}-${c}`} cx={14 + c * 18} cy={14 + r * 18} r={4.5} fill="#ffffff" />);
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 104 86" role="img" aria-label="slidr">
      <rect x={2} y={2} width={100} height={82} rx={14} fill="#1a1d21" />
      <rect x={2} y={2} width={100} height={82} rx={14} fill="none" stroke="#1a1d21" strokeWidth={4} />
      {dots}
      <path d="M40 26 L66 43 L40 60 Z" fill="#f5a623" stroke="#1a1d21" strokeWidth={3} strokeLinejoin="round" />
    </svg>
  );
}
