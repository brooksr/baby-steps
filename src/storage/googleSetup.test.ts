import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./googleSetup');
}

describe('Picker app id', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the project number at the front of the OAuth client id', async () => {
    const setup = await load({ VITE_GOOGLE_APP_ID: 'babysteps-500002', VITE_GOOGLE_CLIENT_ID: '123456789012-abc.apps.googleusercontent.com' });
    expect(setup.GOOGLE_APP_ID).toBe('123456789012');
  });

  it('ignores a project id where the number belongs', async () => {
    const setup = await load({ VITE_GOOGLE_APP_ID: 'babysteps-500002', VITE_GOOGLE_CLIENT_ID: '' });
    expect(setup.GOOGLE_APP_ID).toBe('');
  });
});
