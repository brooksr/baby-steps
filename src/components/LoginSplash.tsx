import { Cloud, Heart, ShieldCheck } from 'lucide-react';
import type { StoreStatus } from '../storage/store';

interface LoginSplashProps {
  error: string;
  loading: boolean;
  storeStatus: StoreStatus | null;
  onContinue: () => Promise<void>;
  onOffline: () => Promise<void>;
}

export function LoginSplash({ error, loading, storeStatus, onContinue, onOffline }: LoginSplashProps) {
  const configured = Boolean(storeStatus?.configured);

  return (
    <main className="splash-screen">
      <section className="splash-panel" aria-labelledby="splash-title">
        <img className="splash-logo" src={`${import.meta.env.BASE_URL}icons/babysteps-logo.png`} alt="BabySteps mother and baby logo" />
        <p className="eyebrow">BabySteps Theo</p>
        <h1 id="splash-title">Shared baby tracker</h1>
        <p className="splash-copy">
          This app writes to the shared Google Sheet after Google consent. The OAuth app is currently in testing, so Google may show a testing notice before the consent screen.
        </p>

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

        {error && <p className="error-banner splash-error" role="alert">{error}</p>}

        <div className="splash-actions">
          <button className="primary-button splash-continue" type="button" onClick={onContinue} disabled={loading || !configured}>
            {loading ? 'Connecting' : 'Continue with Google'}
          </button>
          <button className="secondary-button" type="button" onClick={onOffline} disabled={loading}>
            Continue offline
          </button>
        </div>

        {!configured && <p className="splash-footnote">Google login is not configured in this build, so offline mode is available.</p>}
      </section>
    </main>
  );
}
