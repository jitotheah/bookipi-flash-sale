import { useState } from 'react';

/**
 * "Sign in" is a single identifier field. The server treats whatever lands
 * here as the authenticated account id -- see the note in FlashSaleService on
 * why a real deployment must not.
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
        Sign in with any identifier to join the queue. One device, one person,
        one iPhone.
      </p>

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
      <p className="fineprint">No password — this is a demo storefront.</p>
    </form>
  );
}
