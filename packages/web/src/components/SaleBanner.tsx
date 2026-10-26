import { useEffect, useState } from 'react';
import type { SaleStateResponse } from '@flash/shared';

function countdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Status strip above the product. The countdown runs off the *server* clock
 * delivered with the sale state, offset by how long ago we received it, so a
 * laptop with a wrong system time still sees the real window.
 */
export function SaleBanner({ sale, skewMs }: { sale: SaleStateResponse; skewMs: number }) {
  // Ticks the countdown between polls, so the clock moves every second while
  // the sale state itself is only fetched every couple of seconds.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now() + skewMs;

  const content = {
    upcoming: {
      tone: 'wait',
      label: 'Starts in',
      value: countdown(new Date(sale.startsAt).getTime() - now),
    },
    active: {
      tone: 'live',
      label: 'Sale ends in',
      value: countdown(new Date(sale.endsAt).getTime() - now),
    },
    sold_out: { tone: 'gone', label: 'Sold out', value: 'All units claimed' },
    ended: { tone: 'gone', label: 'Sale closed', value: 'Thanks for stopping by' },
  }[sale.status];

  // The bar shows what is LEFT and drains as units go, which is the reading
  // a shopper expects. A filling bar at "0 left" says the opposite.
  const pct = sale.totalStock === 0 ? 0 : (sale.remainingStock / sale.totalStock) * 100;
  const level = pct === 0 ? 'empty' : pct <= 30 ? 'low' : 'ok';

  return (
    <div className={`banner banner--${content.tone}`}>
      <div className="banner-row">
        <span className="banner-label">
          {content.tone === 'live' && <span className="pulse" aria-hidden="true" />}
          {content.label}
        </span>
        <span className="banner-value">{content.value}</span>
      </div>
      <div
        className="stockbar"
        role="img"
        aria-label={`${sale.remainingStock} of ${sale.totalStock} units left`}
      >
        <div className={`stockbar-fill stockbar-fill--${level}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="banner-row banner-row--sub">
        <span>
          {sale.remainingStock} of {sale.totalStock} left
        </span>
        <span>Limit 1 per customer</span>
      </div>
    </div>
  );
}
