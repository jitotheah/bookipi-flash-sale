import type { SaleStateResponse } from '@flash/shared';
import { formatPrice } from '../lib/api.ts';
import { IPhone } from './IPhone.tsx';

interface Props {
  sale: SaleStateResponse;
  disabled: boolean;
  onBuy: () => void;
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 12.2l2.1 2.1L15.2 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M2 7h11v9H2zM13 10h4l3 3.2V16h-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="18" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="18" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ProductCard({ sale, disabled, onBuy }: Props) {
  const { product, status, remainingStock } = sale;
  const buyable = status === 'active' && remainingStock > 0;

  const buttonLabel =
    status === 'upcoming'
      ? 'Not open yet'
      : status === 'ended'
        ? 'Sale closed'
        : remainingStock > 0
          ? 'BUY NOW'
          : 'Sold out';

  return (
    <div className="card card--product">
      <div className="stage">
        <span className="eyebrow eyebrow--hot">🔥 Hot New Product</span>
        <IPhone />
      </div>

      <h2 className="product-name">{product.name}</h2>
      <p className="product-tagline">{product.tagline}</p>

      <div className="price-row">
        <span className="price">{formatPrice(product.priceCents, product.currency)}</span>
        <span className={`pill pill--${buyable ? 'ok' : 'off'}`}>
          <span className="dot" aria-hidden="true" />
          {buyable ? 'Available' : 'Unavailable'}
        </span>
      </div>

      <button type="button" className="cta" onClick={onBuy} disabled={disabled || !buyable}>
        {buttonLabel} {buyable && <span aria-hidden="true">→</span>}
      </button>

      <div className="trust">
        <span>
          <ShieldIcon /> Secure Checkout
        </span>
        <span>
          <TruckIcon /> Fast &amp; Reliable
        </span>
      </div>
    </div>
  );
}
