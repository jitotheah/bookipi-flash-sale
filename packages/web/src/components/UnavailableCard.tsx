/**
 * Shown when the backend answers 501: the driver behind this endpoint is still
 * a stub. Distinct from an outage on purpose — "not written yet" and "broken"
 * are different facts and the UI should not conflate them.
 */
export function UnavailableCard({ message }: { message: string }) {
  return (
    <div className="card card--state tone-info" role="status">
      <div className="state-icon tone-info">
        <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
          <rect
            x="7"
            y="12"
            width="34"
            height="26"
            rx="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M15 22l-4 4 4 4M33 22l4 4-4 4M27 19l-6 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="state-title">Backend not implemented yet</h2>
      <p className="state-copy">{message}</p>
      <p className="fineprint">
        This is scaffolding reporting itself honestly, not a failure. Add <code>?api=mock</code> to
        preview the finished UI.
      </p>
    </div>
  );
}
