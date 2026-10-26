import { useCallback, useEffect, useRef, useState } from 'react';
import type { PurchaseResponse, SaleStateResponse } from '@flash/shared';
import { Header } from './components/Header.tsx';
import { LoginCard } from './components/LoginCard.tsx';
import { MockBanner } from './components/MockBanner.tsx';
import { ProcessingCard } from './components/ProcessingCard.tsx';
import { ProductCard } from './components/ProductCard.tsx';
import { ResultCard } from './components/ResultCard.tsx';
import { SaleBanner } from './components/SaleBanner.tsx';
import { UnavailableCard } from './components/UnavailableCard.tsx';
import { UncertainCard } from './components/UncertainCard.tsx';
import {
  ApiNotImplementedError,
  attemptPurchase,
  fetchExistingOrder,
  fetchSaleState,
} from './lib/api.ts';

/**
 * The seven states the storefront can be in. `upcoming`, `active`, `sold_out`
 * and `ended` are properties of the sale and live in `sale.status`; the four
 * below are properties of *this user's attempt*.
 *
 * `uncertain` is the one that is easy to leave out and expensive to get wrong:
 * a request that failed in transit has an unknown outcome, and the UI must say
 * so rather than guess.
 */
type Phase =
  | { kind: 'browsing' }
  | { kind: 'processing' }
  | { kind: 'result'; result: PurchaseResponse }
  | { kind: 'uncertain' }
  | { kind: 'unavailable'; message: string };

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
 * pure reads. GUIDE.md step 6 covers the fix (cache this response for ~1s at
 * the edge, or push updates over SSE).
 */
function useSaleState() {
  const [sale, setSale] = useState<SaleStateResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [unimplemented, setUnimplemented] = useState<string | null>(null);
  const skewRef = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSaleState(signal);
      skewRef.current = new Date(next.serverTime).getTime() - Date.now();
      setSale(next);
      setOffline(false);
      setUnimplemented(null);
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiNotImplementedError) setUnimplemented(error.message);
      else setOffline(true);
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

  return { sale, offline, unimplemented, skewMs: skewRef.current, refresh };
}

export function App() {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(USER_KEY));
  const [phase, setPhase] = useState<Phase>({ kind: 'browsing' });
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { sale, offline, unimplemented, skewMs, refresh } = useSaleState();

  const signIn = useCallback(async (id: string) => {
    localStorage.setItem(USER_KEY, id);
    setUserId(id);
    setNotice(null);

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
    setNotice(null);
  }, []);

  const buy = useCallback(async () => {
    if (!userId) return;
    setNotice(null);
    setPhase({ kind: 'processing' });

    try {
      const [result] = await Promise.all([attemptPurchase(userId), wait(MIN_PROCESSING_MS)]);
      setPhase({ kind: 'result', result });
    } catch (error) {
      if (error instanceof ApiNotImplementedError) {
        setPhase({ kind: 'unavailable', message: error.message });
      } else {
        // We do NOT know whether the server committed before the connection
        // dropped. Claiming "nothing was reserved" would be a guess, and the
        // wrong guess either costs the user a unit they own or has them retry
        // after winning. Resolve it with a read instead.
        setPhase({ kind: 'uncertain' });
      }
    } finally {
      void refresh();
    }
  }, [userId, refresh]);

  /** Resolves `uncertain` against the only authoritative answer: the server. */
  const checkMyOrder = useCallback(async () => {
    if (!userId) return;
    setChecking(true);
    try {
      const existing = await fetchExistingOrder(userId);
      if (existing.hasPurchased && existing.order) {
        setPhase({
          kind: 'result',
          result: {
            outcome: 'already_purchased',
            order: existing.order,
            message: 'Your order went through after all.',
          },
        });
      } else {
        setNotice('Confirmed: nothing was reserved, so it is safe to try again.');
        setPhase({ kind: 'browsing' });
      }
    } catch {
      setNotice('Still cannot reach the service. Try checking again in a moment.');
    } finally {
      setChecking(false);
    }
  }, [userId]);

  if (!userId) {
    return (
      <div className="shell">
        <MockBanner />
        <Header />
        <LoginCard onSignIn={signIn} />
        <Footnote offline={offline} />
      </div>
    );
  }

  return (
    <div className="shell">
      <MockBanner />
      <Header userId={userId} onSignOut={signOut} />

      {sale && <SaleBanner sale={sale} skewMs={skewMs} />}
      {notice && <p className="alert">{notice}</p>}

      {unimplemented && phase.kind === 'browsing' ? (
        <UnavailableCard message={unimplemented} />
      ) : (
        <>
          {phase.kind === 'processing' && <ProcessingCard />}

          {phase.kind === 'uncertain' && (
            <UncertainCard checking={checking} onCheck={checkMyOrder} />
          )}

          {phase.kind === 'unavailable' && <UnavailableCard message={phase.message} />}

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
        </>
      )}

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
