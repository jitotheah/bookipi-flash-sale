import type { PurchaseResponse } from '@flash/shared';
import { formatOrderId } from '../lib/api.ts';

function CheckIcon() {
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="currentColor" />
      <path
        d="M14.5 24.5l6.5 6.5 12.5-13"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
      <path
        d="M24 6l16 8v20l-16 8-16-8V14z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M8 14l16 8 16-8M24 22v20" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="37" cy="34" r="9" fill="#fff" />
      <path
        d="M33.5 30.5l7 7M40.5 30.5l-7 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
      <path
        d="M24 12v13l8 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface Props {
  result: PurchaseResponse;
  onRetry: () => void;
  onBack: () => void;
}

/** One card renders every terminal outcome; only the trim changes. */
export function ResultCard({ result, onRetry, onBack }: Props) {
  const view = {
    purchased: {
      tone: 'good',
      icon: <CheckIcon />,
      title: 'Order confirmed!',
      copy: 'Thank you for your purchase.',
      action: null,
    },
    already_purchased: {
      tone: 'info',
      icon: <CheckIcon />,
      title: 'You already have one',
      copy: 'Limit is one per customer — your original order still stands.',
      action: null,
    },
    sold_out: {
      tone: 'bad',
      icon: <BoxIcon />,
      title: 'Out of stock',
      copy: 'This item is no longer available.',
      action: null,
    },
    sale_not_started: {
      tone: 'wait',
      icon: <ClockIcon />,
      title: 'Not open yet',
      copy: 'The sale has not started. Hold tight.',
      action: 'back',
    },
    sale_ended: {
      tone: 'bad',
      icon: <ClockIcon />,
      title: 'Sale closed',
      copy: 'This flash sale has ended.',
      action: null,
    },
    invalid_user: {
      tone: 'bad',
      icon: <BoxIcon />,
      title: "We couldn't read that identifier",
      copy: result.message,
      action: 'retry',
    },
  }[result.outcome];

  return (
    <div className={`card card--state tone-${view.tone}`} role="status" aria-live="polite">
      <div className={`state-icon tone-${view.tone}`}>{view.icon}</div>
      <h2 className="state-title">{view.title}</h2>
      <p className="state-copy">{view.copy}</p>

      {result.order && (
        <div className="order-chip">
          <span aria-hidden="true">🧾</span> Order ID: {formatOrderId(result.order.orderId)}
        </div>
      )}

      {result.outcome === 'purchased' && (
        <p className="fineprint">A brighter you is on the way 💙</p>
      )}

      {view.action === 'retry' && (
        <button type="button" className="cta cta--ghost" onClick={onRetry}>
          Try again
        </button>
      )}
      {view.action === 'back' && (
        <button type="button" className="cta cta--ghost" onClick={onBack}>
          Back to product
        </button>
      )}
    </div>
  );
}
