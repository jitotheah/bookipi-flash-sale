import { useState } from 'react';

/**
 * DEMONSTRATION IDENTITY — NOT AUTHENTICATION.
 *
 * This is a single text field with no password, no session, no verification.
 * Whatever is typed here becomes the dedupe key the server enforces "one per
 * user" against, which means the rule is trivially bypassed by typing a
 * different name. That is acceptable for a demo and unacceptable in
 * production.
 *
 * A real deployment replaces this with a signed session and keys the purchase
 * on the authenticated account id, so the identity comes from the server's
 * trust, not the client's keyboard. The server-side counterpart of this note
 * is in FlashSaleService.normaliseUserId.
 */
export function LoginCard({ onSignIn }: { onSignIn: (userId: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const candidate = value.trim().toLowerCase();
    if (!/^[a-z0-9._@+-]{3,64}$/.test(candidate)) {
      setError('3–64 characters: letters, numbers, or . _ - + @');
      return;
    }
    setError(null);
    onSignIn(candidate);
  }

  return (
    <form className="card card--login" onSubmit={submit}>
      <span className="eyebrow eyebrow--hot">Flash sale</span>
      <h1 className="login-title">One drop. Ten units.</h1>
      <p className="login-copy">
        Enter any identifier to join the queue. One per customer, ten units
        total.
      </p>

      <div className="disclaimer">
        <strong>Demo identity, not authentication.</strong> No password is
        checked and nothing is verified — this identifier is only the key the
        sale counts purchases against. Production would use a signed session
        and the authenticated account id instead.
      </div>

      <label className="field">
        <span className="field-label">Email or username</span>
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="ada@example.com"
          autoComplete="username"
          autoFocus
        />
      </label>

      {error && <p className="field-error">{error}</p>}

      <button type="submit" className="cta">
        Continue <span aria-hidden="true">→</span>
      </button>
      <p className="fineprint">Booki Marketplace is a fictional demo storefront.</p>
    </form>
  );
}
