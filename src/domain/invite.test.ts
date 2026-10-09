import { describe, expect, it } from 'vitest';
import { buildInvite } from './invite';

const link = 'https://example.github.io/baby-steps/?family=sheet-a';

describe('buildInvite', () => {
  it('carries the link and names the account to sign in with', () => {
    const invite = buildInvite({ email: 'nan@example.com', kind: 'caregiver', name: 'Nan Example' }, { name: 'Casey Example' }, link);

    expect(invite.subject).toBe('Casey added you to BabySteps');
    expect(invite.body).toContain(link);
    expect(invite.body).toContain('nan@example.com');
    expect(invite.body).toContain('Hi Nan,');
    expect(invite.body).toMatch(/Key info and the Emergency guide/);
  });

  it('addresses a mailto to the invitee with the message filled in', () => {
    const invite = buildInvite({ email: 'sam@example.com', kind: 'parent', name: 'Sam' }, undefined, link);

    expect(invite.mailto.startsWith('mailto:sam%40example.com?subject=')).toBe(true);
    expect(decodeURIComponent(invite.mailto)).toContain(link);
    expect(invite.body).toContain('see and log everything');
  });
});
