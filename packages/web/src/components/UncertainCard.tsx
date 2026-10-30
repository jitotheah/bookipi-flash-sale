interface Props {
  checking: boolean;
  onCheck: () => void;
  onRetry: () => void;
}

/** Shown while the purchase outcome remains unconfirmed. */
export function UncertainCard({
  checking,
  onCheck,
  onRetry,
}: Props) {
  return (
    <div
      className="card card--state tone-wait"
      role="status"
      aria-live="polite"
    >
      <div className="state-icon tone-wait">
        <svg
          viewBox="0 0 48 48"
          width="56"
          height="56"
          aria-hidden="true"
        >
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
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

      <h2 className="state-title">
        We couldn&apos;t confirm your purchase
      </h2>

      <p className="state-copy">
        Your request may still be processing. Check your order,
        or retry using the same sign-in details.
      </p>

      <button
        type="button"
        className="cta"
        onClick={onCheck}
        disabled={checking}
      >
        {checking ? 'Checking…' : 'Check my order'}
      </button>

      <button
        type="button"
        className="cta cta--ghost"
        onClick={onRetry}
        disabled={checking}
      >
        Retry purchase
      </button>

      <p className="fineprint">
        Checking never places an order.
      </p>
    </div>
  );
}