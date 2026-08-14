import { Cloud, Heart, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StoreStatus } from '../storage/store';

/** How long a silent reconnect runs before we offer an offline escape hatch. */
const SLOW_RESTORE_MS = 6_000;

interface LoginSplashProps {
  error: string;
  loading: boolean;
  /** Resuming a device that has already granted Google — no sign-in needed. */
  restoring: boolean;
  /** A stored grant stopped working, so this is a reconnect rather than a first run. */
  sessionExpired: boolean;
  storeStatus: StoreStatus | null;
  onContinue: () => Promise<void>;
  onOffline: () => Promise<void>;
}

export function LoginSplash({ error, loading, restoring, sessionExpired, storeStatus, onContinue, onOffline }: LoginSplashProps) {
  const configured = Boolean(storeStatus?.configured);
  const [slowRestore, setSlowRestore] = useState(false);

  useEffect(() => {
    if (!restoring) {
      setSlowRestore(false);
      return;
    }

    const timer = window.setTimeout(() => setSlowRestore(true), SLOW_RESTORE_MS);
    return () => window.clearTimeout(timer);
  }, [restoring]);

  return (
    <main className="splash-screen">
      <section className="splash-panel" aria-labelledby="splash-title">
        <img className="splash-logo" src={`${import.meta.env.BASE_URL}icons/babysteps-logo.png`} alt="BabySteps mother and baby logo" />
        <p className="eyebrow">BabySteps Theo</p>

        {restoring ? (
          <>
            <h1 id="splash-title">Welcome back</h1>
            <p className="splash-copy" role="status">Signing you back in and syncing the shared sheet.</p>
            <div className="splash-restoring" aria-hidden="true">
              <div className="loader" />
            </div>
            {slowRestore && (
              <div className="splash-actions">
                <button className="secondary-button" type="button" onClick={onOffline} disabled={loading}>
                  Taking a while — open offline
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 id="splash-title">{sessionExpired ? 'Tap to reconnect' : 'Shared baby tracker'}</h1>
            <p className="splash-copy">
              {sessionExpired
                ? 'Google needs a quick re-approval before syncing again. Your logs are safe in the shared sheet — nothing was lost.'
                : 'This app writes to the shared Google Sheet after Google consent. You only need to connect once per device — after that it stays signed in. The OAuth app is in testing, so Google may show a testing notice the first time.'}
            </p>

            {!sessionExpired && (
              <div className="splash-steps" aria-label="Sign in steps">
                <article>
                  <Heart aria-hidden="true" />
                  <span>Tap Continue</span>
                </article>
                <article>
                  <ShieldCheck aria-hidden="true" />
                  <span>Choose an approved test user</span>
                </article>
                <article>
                  <Cloud aria-hidden="true" />
                  <span>Accept Sheets access</span>
                </article>
              </div>
            )}

            {error && <p className="error-banner splash-error" role="alert">{error}</p>}

            <div className="splash-actions">
              <button className="primary-button splash-continue" type="button" onClick={onContinue} disabled={loading || !configured}>
                {loading ? 'Connecting' : sessionExpired ? 'Reconnect Google' : 'Continue with Google'}
              </button>
              <button className="secondary-button" type="button" onClick={onOffline} disabled={loading}>
                Continue offline
              </button>
            </div>

            {!configured && <p className="splash-footnote">Google login is not configured in this build, so offline mode is available.</p>}
          </>
        )}
      </section>
    </main>
  );
}
