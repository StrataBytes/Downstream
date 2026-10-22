import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { useSearchStore, closeSearch } from '../services/searchService';
import InputBar from './InputBar';
import NowPlaying from './NowPlaying';
import MusicPlayer from './MusicPlayer';
import SearchPanel from './SearchPanel';

// grows or shrinks the widget from its old box to its new one, including the move between positions.
// new content fades in once the box is on its way.
// only layouts on the same screen morph, a new screen arrives while the whole view is faded out.
function useResizeAnimation(ref, screen, layoutKey, contentKey) {
  const shown = useRef({ screen, layoutKey, contentKey });
  const from = useRef(null);
  // measured while rendering, before the page changes, so it is the box on screen right now.
  if (shown.current.screen !== screen || shown.current.layoutKey !== layoutKey) {
    // a new screen keeps no old box, so it only settles.
    from.current = shown.current.screen === screen
      ? { rect: ref.current?.getBoundingClientRect(), swapped: shown.current.contentKey !== contentKey }
      : {};
    shown.current = { screen, layoutKey, contentKey };
  }
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = from.current;
    from.current = null;
    if (!el || !prev) return;
    // the last resize and the padding transition are settled first, so the new box is measured at its final size.
    el.getAnimations().forEach((a) => {
      if (a.id === 'widget-resize' || a instanceof CSSTransition) a.finish();
    });
    // a new screen fades in already at its own size.
    if (!prev.rect || document.body.classList.contains('lite-no-anim')) return;
    const next = el.getBoundingClientRect();
    const dx = prev.rect.left + prev.rect.width / 2 - (next.left + next.width / 2);
    const dy = prev.rect.top + prev.rect.height / 2 - (next.top + next.height / 2);
    el.animate([
      { width: `${prev.rect.width}px`, height: `${prev.rect.height}px`, transform: `translate(${dx}px, ${dy}px)` },
      { width: `${next.width}px`, height: `${next.height}px`, transform: 'translate(0, 0)' },
    ], { id: 'widget-resize', duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    if (prev.swapped) {
      el.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 110, easing: 'ease', fill: 'backwards' });
    }
  }, [screen, layoutKey]);
}

export default function PrimaryWidget() {
  const currentView = useAppStore((s) => s.currentView);
  const playerViewMode = useAppStore((s) => s.playerViewMode);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicFolder = useAppStore((s) => s.musicFolder);
  const playing = useAppStore((s) => s.musicPlaying);
  const folderScreen = useAppStore((s) => s.folderScreen);
  const panelOpen = useAppStore((s) => s.musicLibraryOpen || s.eqOpen || s.behaviorOpen || s.normInfoOpen || s.optionsOpen);
  const immersive = currentView === 'player' && playerViewMode === 'immersive' && !!musicCurrent && !!musicFolder && !folderScreen;
  const setImmersiveIdle = useAppStore((s) => s.setImmersiveIdle);
  const isDownloading = useAppStore((s) => s.isDownloading);
  const searching = useSearchStore((s) => s.open) && currentView === 'download';
  // matches when the queue sidebar is showing.
  const besideQueue = useAppStore((s) => s.queueOpen || s.queue.length > 0 || s.queueHistory.length > 0);
  // the mini player sits at the top center outside the player.
  const belowMini = useAppStore((s) => !!s.musicCurrent);
  const panelRef = useRef(null);
  const [idle, setIdle] = useState(false);

  const mode = searching ? 'search' : 'normal';
  useResizeAnimation(panelRef, folderScreen ? 'folders' : currentView, searching ? `search:${besideQueue}:${belowMini}` : mode, mode);

  // starting a download returns to the normal widget, where its progress shows.
  const wasDownloading = useRef(isDownloading);
  useEffect(() => {
    if (isDownloading && !wasDownloading.current) closeSearch();
    wasDownloading.current = isDownloading;
  }, [isDownloading]);

  // search and the link controls only last for one visit to the downloader.
  useEffect(() => {
    if (currentView === 'download') return;
    closeSearch();
    useAppStore.getState().setLinkControlsRevealed(false);
  }, [currentView]);

  useEffect(() => {
    setImmersiveIdle(idle);
  }, [idle, setImmersiveIdle]);

  useEffect(() => {
    setIdle(false);
    if (!immersive || !playing || panelOpen) return;
    let timer;
    let held = false;
    const wake = () => {
      clearTimeout(timer);
      setIdle(false);
      timer = setTimeout(() => {
        const panel = panelRef.current;
        if (!held && !panel?.matches(':hover')) setIdle(true);
      }, 5000);
    };
    const down = () => { held = true; wake(); };
    const up = () => { held = false; wake(); };
    const events = { pointermove: wake, keydown: wake, focusin: wake, focusout: wake, pointerdown: down, pointerup: up, pointercancel: up, blur: up };
    Object.entries(events).forEach(([event, handler]) => window.addEventListener(event, handler));
    wake();
    return () => {
      clearTimeout(timer);
      Object.entries(events).forEach(([event, handler]) => window.removeEventListener(event, handler));
    };
  }, [immersive, playing, panelOpen]);

  return (
    <div ref={panelRef} className={`primary-widget${immersive ? ' primary-widget-immersive' : ''}${immersive && idle ? ' primary-widget-idle' : ''}${searching ? ' primary-widget-search' : ''}${searching && besideQueue ? ' primary-widget-beside-queue' : ''}${searching && belowMini ? ' primary-widget-below-mini' : ''}${folderScreen ? ' primary-widget-folders' : ''}`}>
      <div className="primary-content">
        {currentView === 'player' ? (
          <MusicPlayer />
        ) : searching ? (
          <SearchPanel />
        ) : (
          <>
            <InputBar />
            <NowPlaying />
          </>
        )}
      </div>
    </div>
  );
}
