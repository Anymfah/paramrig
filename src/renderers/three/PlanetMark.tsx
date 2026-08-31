export function PlanetMark() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true">
      <rect width="320" height="200" fill="#141C1C" />
      <ellipse cx="160" cy="104" rx="128" ry="36" fill="none" stroke="#566460" strokeOpacity="0.45" transform="rotate(-16 160 104)" />
      <circle cx="160" cy="100" r="58" fill="#263D42" />
      <circle cx="160" cy="100" r="58" fill="url(#p)" />
      <ellipse cx="160" cy="92" rx="44" ry="18" fill="none" stroke="#c5d4cc" strokeOpacity="0.28" />
      <ellipse cx="160" cy="108" rx="36" ry="12" fill="none" stroke="#c5d4cc" strokeOpacity="0.22" />
      <ellipse cx="168" cy="100" rx="22" ry="28" fill="none" stroke="#e2ddbc" strokeOpacity="0.18" />
      <ellipse cx="160" cy="100" rx="64" ry="14" fill="none" stroke="#9bb8b0" strokeOpacity="0.6" />
      <ellipse cx="160" cy="100" rx="78" ry="18" fill="none" stroke="#8aa39c" strokeOpacity="0.35" />
      <defs>
        <radialGradient id="p" cx="38%" cy="32%">
          <stop offset="0" stopColor="#E2DDBC" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#819893" />
          <stop offset="1" stopColor="#1a2a2c" />
        </radialGradient>
      </defs>
    </svg>
  )
}
