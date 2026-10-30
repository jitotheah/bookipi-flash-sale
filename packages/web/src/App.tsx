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

  // A response may arrive after the shopper switches users or starts another
  // action. Only the latest action for the current user may update this UI.
  const currentUserRef = useRef(userId);
  const requestVersionRef = useRef(0);

  const isCurrentRequest = useCallback((version: number, id: string) => (
    requestVersionRef.current === version && currentUserRef.current === id
  ), []);

  const restoreOrder = useCallback(async (
    id: string,
    version: number,
    signal?: AbortSignal,
  ) => {

    try {
      const existing = await fetchExistingOrder(id);
      if (signal?.aborted || !isCurrentRequest(version, id)) return;

      if (existing.hasPurchased && existing.order) {
        setPhase({
          kind: 'result',
          result: {
            outcome: 'already_purchased',
            order: existing.order,
            message: 'You already secured one.',
          },
        });
      }
    } catch {
      // A failed lookup does not establish whether an order exists. A purchase
      // attempt can still recover an existing order using the same identifier.
    }
    // Do not reset the phase after awaiting: a purchase may already be underway.
  }, [isCurrentRequest]);

  useEffect(() => {
    // Restore a remembered user's order after a reload, but never let this
    // initial check supersede an action the shopper has already started.
    const controller = new AbortController();
    const id = currentUserRef.current;
    if (id && requestVersionRef.current === 0) {
      void restoreOrder(id, 0, controller.signal);
    }

    return () => controller.abort();
  }, [restoreOrder]);

  const signIn = useCallback((id: string) => {
    const version = ++requestVersionRef.current;
    localStorage.setItem(USER_KEY, id);
    currentUserRef.current = id;
    setUserId(id);
    setPhase({ kind: 'browsing' });
    setChecking(false);
    setNotice(null);
    void restoreOrder(id, version);
  }, [restoreOrder]);

  const signOut = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    currentUserRef.current = null;
    requestVersionRef.current += 1;
    setUserId(null);
    setPhase({ kind: 'browsing' });
    setChecking(false);
    setNotice(null);
  }, []);

  const buy = useCallback(async () => {
    const id = currentUserRef.current;
    if (!id) return;
    const version = ++requestVersionRef.current;

    setChecking(false);
    setNotice(null);
    setPhase({ kind: 'processing' });

    try {
      const [result] = await Promise.all([attemptPurchase(id), wait(MIN_PROCESSING_MS)]);
      if (!isCurrentRequest(version, id)) return;
      setPhase({ kind: 'result', result });
    } catch (error) {
      if (!isCurrentRequest(version, id)) return;

      if (error instanceof ApiNotImplementedError) {
        setPhase({ kind: 'unavailable', message: error.message });
      } else {
        // Ignoring an obsolete UI response does not cancel its transaction.
        // The original user can recover their order by signing in again.
        setPhase({ kind: 'uncertain' });
      }
    } finally {
      if (isCurrentRequest(version, id)) void refresh();
    }
  }, [isCurrentRequest, refresh]);

  const checkMyOrder = useCallback(async () => {
    const id = currentUserRef.current;
    if (!id) return;
    const version = ++requestVersionRef.current;

    setNotice(null);
    setChecking(true);

    try {
      const existing = await fetchExistingOrder(id);
      if (!isCurrentRequest(version, id)) return;

      if (existing.hasPurchased && existing.order) {
        setPhase({
          kind: 'result',
          result: {
            outcome: 'already_purchased',
            order: existing.order,
            message: 'Your order was confirmed.',
          },
        });
      } else {
        setNotice(
          'No order is visible yet. Your earlier request may still be processing. Check again, or retry using the same identifier.',
        );
      }
    } catch {
      if (!isCurrentRequest(version, id)) return;
      setNotice(
        'We still cannot check your order. Please try again shortly.',
      );
    } finally {
      if (isCurrentRequest(version, id)) setChecking(false);
    }
  }, [isCurrentRequest]);

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
            <UncertainCard
              checking={checking}
              onCheck={checkMyOrder}
              onRetry={buy}
            />
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
