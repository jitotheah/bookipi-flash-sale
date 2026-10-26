/**
 * The product shot, drawn inline rather than loaded as an asset: it stays
 * crisp at any size, adds no network request on the single most traffic-heavy
 * page of the sale, and keeps the repo free of binary files.
 */
export function IPhone({ size = 236 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 220 400"
      width={size}
      height={size * (400 / 220)}
      role="img"
      aria-label="iPhone 17 Pro in natural titanium"
    >
      <defs>
        <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8d8d95" />
          <stop offset="30%" stopColor="#e2e2e6" />
          <stop offset="62%" stopColor="#95959d" />
          <stop offset="100%" stopColor="#cfcfd5" />
        </linearGradient>
        <linearGradient id="screen" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#1b2335" />
          <stop offset="50%" stopColor="#0a0f1d" />
          <stop offset="100%" stopColor="#121a2c" />
        </linearGradient>
        <radialGradient id="bloom" cx="0.5" cy="0.62" r="0.62">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#6366f1" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
        <clipPath id="screenClip">
          <rect x="20" y="18" width="180" height="364" rx="33" />
        </clipPath>
        <linearGradient id="glare" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="48%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* titanium frame */}
      <rect x="10" y="8" width="200" height="384" rx="42" fill="url(#frame)" />
      <rect x="15.5" y="13.5" width="189" height="373" rx="37" fill="#0b1020" />

      {/* display */}
      <rect x="20" y="18" width="180" height="364" rx="33" fill="url(#screen)" />
      <g clipPath="url(#screenClip)">
        <ellipse cx="110" cy="248" rx="104" ry="104" fill="url(#bloom)" />
        <path
          d="M44 302c22-66 68-104 148-114"
          fill="none"
          stroke="#60a5fa"
          strokeOpacity="0.55"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M44 332c30-80 86-122 160-132"
          fill="none"
          stroke="#a78bfa"
          strokeOpacity="0.38"
          strokeWidth="6.5"
          strokeLinecap="round"
        />
      </g>
      <rect x="20" y="18" width="180" height="364" rx="33" fill="url(#glare)" />

      {/* lock-screen furniture: reads as "a phone that is on" */}
      <text
        x="110"
        y="112"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="46"
        fontWeight="300"
        fill="#ffffff"
        fillOpacity="0.92"
      >
        9:41
      </text>
      <rect x="86" y="362" width="48" height="4" rx="2" fill="#ffffff" fillOpacity="0.5" />

      {/* dynamic island */}
      <rect x="88" y="30" width="44" height="13" rx="6.5" fill="#05070e" />
      <circle cx="124" cy="36.5" r="3.4" fill="#10172a" />

      {/* side buttons */}
      <rect x="208" y="118" width="4" height="48" rx="2" fill="#a8a8b0" />
      <rect x="8" y="100" width="4" height="22" rx="2" fill="#a8a8b0" />
      <rect x="8" y="132" width="4" height="34" rx="2" fill="#a8a8b0" />
      <rect x="8" y="176" width="4" height="34" rx="2" fill="#a8a8b0" />
    </svg>
  );
}
