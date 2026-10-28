import { useEffect, useLayoutEffect, useRef } from 'react';

/** Frames to keep trying while a tab's content is still growing to its old height. */
const RESTORE_FRAMES = 10;

/**
 * Each tab keeps its own scroll position. A tab not visited yet opens at the
 * top; going back to one puts the same content on screen as when it was left.
 * The window is the scroller, so one map of tab → scrollY is all it takes.
 */
export function useTabScroll(tab: string) {
  const positions = useRef(new Map<string, number>());
  const current = useRef(tab);

  useEffect(() => {
    // The browser's own restoration would fight this on back/forward.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const save = () => positions.current.set(current.current, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);

  useLayoutEffect(() => {
    if (current.current === tab) return;
    current.current = tab;
    const target = positions.current.get(tab) ?? 0;
    window.scrollTo(0, target);
    if (target === 0) return;

    // Charts and loaded data can render a beat later, so a page shorter than
    // the saved spot is clamped at first; retry while it is still clamped. Once
    // the page could reach the spot, a different position means someone scrolled.
    let frames = 0;
    let frame = requestAnimationFrame(function retry() {
      if (current.current !== tab || ++frames > RESTORE_FRAMES) return;
      const reachable = document.documentElement.scrollHeight - window.innerHeight;
      if (Math.abs(window.scrollY - target) < 1) return;
      if (window.scrollY < reachable - 1) return;
      window.scrollTo(0, target);
      frame = requestAnimationFrame(retry);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);
}
