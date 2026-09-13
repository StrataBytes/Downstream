import { useEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import InputBar from './InputBar';
import NowPlaying from './NowPlaying';
import MusicPlayer from './MusicPlayer';

export default function PrimaryWidget() {
  const currentView = useAppStore((s) => s.currentView);
  const playerViewMode = useAppStore((s) => s.playerViewMode);
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicFolder = useAppStore((s) => s.musicFolder);
  const folderView = useAppStore((s) => s.musicFolderView);
  const playing = useAppStore((s) => s.musicPlaying);
  const panelOpen = useAppStore((s) => s.musicLibraryOpen || s.eqOpen || s.behaviorOpen || s.normInfoOpen || s.optionsOpen);
  const immersive = currentView === 'player' && playerViewMode === 'immersive' && !!musicCurrent && !!musicFolder && !folderView;
  const setImmersiveIdle = useAppStore((s) => s.setImmersiveIdle);
  const panelRef = useRef(null);
  const [idle, setIdle] = useState(false);

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
    <div ref={panelRef} className={`primary-widget${immersive ? ' primary-widget-immersive' : ''}${immersive && idle ? ' primary-widget-idle' : ''}`}>
      <div className="primary-content">
        {currentView === 'player' ? (
          <MusicPlayer />
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
