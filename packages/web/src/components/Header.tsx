export function Header({ userId, onSignOut }: { userId?: string; onSignOut?: () => void }) {
  return (
    <header className="brandbar">
      <div className="brand">
        <span className="brand-mark">Booki</span>
        <span className="brand-sub">Marketplace</span>
      </div>
      {userId ? (
        <button type="button" className="account" onClick={onSignOut} title="Switch user">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="9.6" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M5.9 19.2a6.6 6.6 0 0 1 12.2 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span>{userId}</span>
        </button>
      ) : (
        <span className="tagline">Better things for a brighter you</span>
      )}
    </header>
  );
}
