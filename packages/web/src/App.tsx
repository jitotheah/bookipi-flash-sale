import { useCallback, useEffect, useRef, useState } from 'react';
import type { PurchaseResponse, SaleStateResponse } from '@flash/shared';
import { Header } from './components/Header.tsx';
import { LoginCard } from './components/LoginCard.tsx';
import { ProcessingCard } from './components/ProcessingCard.tsx';
import { ProductCard } from './components/ProductCard.tsx';
import { ResultCard } from './components/ResultCard.tsx';
import { SaleBanner } from './components/SaleBanner.tsx';
import { attemptPurchase, fetchExistingOrder, fetchSaleState } from './lib/api.ts';

type Phase =
  | { kind: 'browsing' }
  | { kind: 'processing' }
  | { kind: 'result'; result: PurchaseResponse };

const POLL_MS = 2_000;
/** Cosmetic floor on the "Processing…" state so it is visible on a fast API. */
const MIN_PROCESSING_MS = 900;
const USER_KEY = 'booki.userId';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the sale state and tracks clock skew between this browser and the API.
 *
 * Polling is the pragmatic choice for a demo. At real flash-sale scale it is
 * the first thing to change: 50k browsers polling every 2s is 25k req/s of
 * pure reads. GUIDE.md step 5 covers the fix (cache this response for ~1s at
 * the edge, or push updates over SSE).
 */
function useSaleState() {
  const [sale, setSale] = useState<SaleStateResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const skewRef = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSaleState(signal);
      skewRef.current = new Date(next.serverTime).getTime() - Date.now();
      setSale(next);
      setOffline(false);
    } catch {
      if (!signal?.aborted) setOffline(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);

    const timer = setInterval(() => {
      // Don't poll a tab nobody is looking at.
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    }, POLL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  return { sale, offline, skewMs: skewRef.current, refresh };
}

export function App() {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(USER_KEY));
  const [phase, setPhase] = useState<Phase>({ kind: 'browsing' });
  const [error, setError] = useState<string | null>(null);
  const { sale, offline, skewMs, refresh } = useSaleState();

  const signIn = useCallback(async (id: string) => {
    localStorage.setItem(USER_KEY, id);
    setUserId(id);
    setError(null);

    // If this user already holds a unit (from an earlier visit, or another
    // tab), show that straight away instead of letting them press Buy again.
    try {
      const existing = await fetchExistingOrder(id);
      if (existing.hasPurchased && existing.order) {
        setPhase({
          kind: 'result',
          result: {
            outcome: 'already_purchased',
            order: existing.order,
            message: 'You already secured one.',
          },
        });
        return;
      }
    } catch {
      /* non-fatal: the purchase attempt itself is still authoritative */
    }
    setPhase({ kind: 'browsing' });
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    setUserId(null);
    setPhase({ kind: 'browsing' });
    setError(null);
  }, []);

  const buy = useCallback(async () => {
    if (!userId) return;
    setError(null);
    setPhase({ kind: 'processing' });

    try {
      const [result] = await Promise.all([attemptPurchase(userId), wait(MIN_PROCESSING_MS)]);
      setPhase({ kind: 'result', result });
    } catch {
      // The reservation is atomic and keyed by user, so a failed request means
      // nothing was taken and a retry is safe. Say so plainly.
      setError('Connection problem — nothing was reserved. Please try again.');
      setPhase({ kind: 'browsing' });
    } finally {
      void refresh();
    }
  }, [userId, refresh]);

  if (!userId) {
    return (
      <div className="shell">
        <Header />
        <LoginCard onSignIn={signIn} />
        <Footnote offline={offline} />
      </div>
    );
  }

  return (
    <div className="shell">
      <Header userId={userId} onSignOut={signOut} />

      {sale && <SaleBanner sale={sale} skewMs={skewMs} />}
      {error && <p className="alert">{error}</p>}

      {phase.kind === 'processing' && <ProcessingCard />}

      {phase.kind === 'result' && (
        <ResultCard
          result={phase.result}
          onRetry={() => setPhase({ kind: 'browsing' })}
          onBack={() => setPhase({ kind: 'browsing' })}
        />
      )}

      {phase.kind === 'browsing' &&
        (sale ? (
          <ProductCard sale={sale} disabled={false} onBuy={buy} />
        ) : (
          <div className="card card--state">
            <div className="spinner" aria-hidden="true" />
            <p className="state-copy">Loading the drop…</p>
          </div>
        ))}

      <Footnote offline={offline} />
    </div>
  );
}

function Footnote({ offline }: { offline: boolean }) {
  return (
    <p className="footnote">
      {offline ? '⚠ Cannot reach the sale service — retrying…' : 'Booki Marketplace · demo build'}
    </p>
  );
}
