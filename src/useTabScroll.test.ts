import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTabScroll } from './useTabScroll';

let scrollY = 0;
const scrollTo = vi.fn((_x: number, y: number) => { scrollY = y; });

beforeEach(() => {
  scrollY = 0;
  scrollTo.mockClear();
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as unknown as typeof window.scrollTo);
});

afterEach(() => vi.restoreAllMocks());

function scrollWindow(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event('scroll'));
}

it('opens a new tab at the top and returns each tab to where it was left', () => {
  const { rerender } = renderHook(({ tab }) => useTabScroll(tab), { initialProps: { tab: 'Log' } });
  scrollWindow(0);

  rerender({ tab: 'Reports' });
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  scrollWindow(1800);

  rerender({ tab: 'Log' });
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

  rerender({ tab: 'Reports' });
  expect(scrollTo).toHaveBeenLastCalledWith(0, 1800);
});

it('does not move the page when the tab has not changed', () => {
  const { rerender } = renderHook(({ tab }) => useTabScroll(tab), { initialProps: { tab: 'Home' } });
  scrollWindow(400);
  rerender({ tab: 'Home' });
  expect(scrollTo).not.toHaveBeenCalled();
});
