import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredFeedMethod, storeFeedMethod } from './feedMethod';

describe('remembering the feed method', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens on nursing until a feed has been saved on this device', () => {
    expect(getStoredFeedMethod()).toBe('nursing');
  });

  it('opens on whichever method this device saved last', () => {
    storeFeedMethod('bottle');
    expect(getStoredFeedMethod()).toBe('bottle');
    storeFeedMethod('nursing');
    expect(getStoredFeedMethod()).toBe('nursing');
  });

  it('reads anything unrecognised as nursing', () => {
    localStorage.setItem('babysteps.feedMethod', 'spoon');
    expect(getStoredFeedMethod()).toBe('nursing');
  });
});
