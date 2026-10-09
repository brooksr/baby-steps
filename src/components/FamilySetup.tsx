import { LogOut, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { parentRoleLabels, type BabyProfile, type ParentRole } from '../domain/types';
import type { NewFamilyInput } from '../storage/hybridStore';

interface FamilySetupProps {
  /** Parents of a family that has never recorded a parent's email — one of them may be this account. */
  claim?: { familyId: string; parents: BabyProfile[] };
  email?: string;
  error: string;
  loading: boolean;
  onClaim: (familyId: string, parentId: string) => Promise<void>;
  onCreate: (input: NewFamilyInput) => Promise<void>;
  onSignOut: () => void;
}

const PARENT_ROLES = Object.keys(parentRoleLabels) as ParentRole[];

/**
 * What an account that belongs to no family sees: none of anyone's log, an
 * offer to start its own family, and — only on a family that has not set up
 * sign-in yet — a way to say which parent it is.
 */
export function FamilySetup({ claim, email, error, loading, onClaim, onCreate, onSignOut }: FamilySetupProps) {
  const [parentName, setParentName] = useState('');
  const [parentRole, setParentRole] = useState<ParentRole>('parent');
  const [childName, setChildName] = useState('');
  const [dueDate, setDueDate] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void onCreate({ childName, dueDate, parentName, parentRole });
  }

  return (
    <main className="splash-screen">
      <section className="splash-panel family-setup" aria-labelledby="family-setup-title">
        <p className="eyebrow">BabySteps</p>
        <h1 id="family-setup-title">Start your family</h1>
        <p className="splash-copy">
          {email ? <><strong>{email}</strong> isn't part of a family here yet.</> : "This Google account isn't part of a family here yet."} If
          someone already tracks with BabySteps, ask a parent to add this email in Settings → Family. Or start your own: it gets its own
          spreadsheet in your Google Drive, and only the people you add can open it.
        </p>

        {claim && (
          <div className="family-claim">
            <p className="splash-copy">This family hasn't set up sign-in yet. If you're one of its parents, say which:</p>
            {claim.parents.map((parent) => (
              <button
                className="secondary-button"
                disabled={loading}
                key={parent.id}
                type="button"
                onClick={() => void onClaim(claim.familyId, parent.id)}
              >
                <UserRound aria-hidden="true" />
                <span>I'm {parent.name}</span>
              </button>
            ))}
          </div>
        )}

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Your name
            <input value={parentName} onChange={(event) => setParentName(event.target.value)} required />
          </label>
          <label>
            You are
            <select value={parentRole} onChange={(event) => setParentRole(event.target.value as ParentRole)}>
              {PARENT_ROLES.map((option) => (
                <option key={option} value={option}>{parentRoleLabels[option]}</option>
              ))}
            </select>
          </label>
          <label>
            Baby's name <span className="field-hint">(optional)</span>
            <input value={childName} onChange={(event) => setChildName(event.target.value)} />
          </label>
          <label>
            Due date <span className="field-hint">(optional)</span>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={!childName.trim()} />
          </label>
          {error && <p className="error-banner splash-error form-grid-wide" role="alert">{error}</p>}
          <button className="primary-button form-grid-wide" type="submit" disabled={loading}>
            {loading ? 'Setting up' : 'Start my family'}
          </button>
        </form>

        <button className="secondary-button" type="button" onClick={onSignOut} disabled={loading}>
          <LogOut aria-hidden="true" />
          <span>Sign out · use another account</span>
        </button>
      </section>
    </main>
  );
}
