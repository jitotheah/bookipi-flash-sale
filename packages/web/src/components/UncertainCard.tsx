interface Props {
  checking: boolean;
  onCheck: () => void;
}

/**
 * The honest answer to a purchase request that failed at the transport layer.
 *
 * The client CANNOT know whether the server committed before the connection
 * dropped, so the UI must not claim either way. Telling the user "nothing was
 * reserved" would be a guess, and the wrong guess means they retry after
 * already winning, or walk away from a unit they own. The resolution is a
 * read: GET /api/purchase/:userId is authoritative, and safe to call as often
 * as needed.
 */
export function UncertainCard({ checking, onCheck }: Props) {
  return (
    <div className="card card--state tone-wait" role="status" aria-live="polite">
      <div className="state-icon tone-wait">
        <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
          <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
          <path
            d="M18.5 18.2a5.7 5.7 0 0 1 11 2c0 3.8-5.5 4.4-5.5 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="24" cy="34.5" r="2.1" fill="currentColor" />
        </svg>
      </div>

      <h2 className="state-title">We lost the connection</h2>
      <p className="state-copy">
        Your request may or may not have gone through — we can&apos;t tell from here. Check your
        order to find out for certain.
      </p>

      <button type="button" className="cta" onClick={onCheck} disabled={checking}>
        {checking ? 'Checking…' : 'Check my order'}
      </button>
      <p className="fineprint">Checking is always safe and never buys anything.</p>
    </div>
  );
}
