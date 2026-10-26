import { API_MODE, MOCK_SCENARIO } from '../lib/api.ts';

/**
 * Always visible while the mock adapter is active. Simulated data must never
 * be mistakable for real data — not in a demo, not in a screenshot, not in a
 * review.
 */
export function MockBanner() {
  if (API_MODE !== 'mock') return null;

  return (
    <div className="mockbar" role="note">
      <strong>MOCK ADAPTER</strong>
      <span>
        Simulated in this browser tab — no backend, nothing persisted. Scenario:{' '}
        <code>{MOCK_SCENARIO}</code>. Append <code>?api=live</code> once the Postgres driver is
        written.
      </span>
    </div>
  );
}
