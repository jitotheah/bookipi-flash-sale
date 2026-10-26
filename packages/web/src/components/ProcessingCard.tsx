export function ProcessingCard() {
  return (
    <div className="card card--state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2 className="state-title">Processing…</h2>
      <p className="state-copy">Please wait while we confirm your order.</p>
    </div>
  );
}
