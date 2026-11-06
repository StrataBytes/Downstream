import { useState, useEffect, useRef } from 'react';
import useAppStore from './stores/useAppStore';
import { wantsFolderScreen, syncNativeFolders, loadDeleted } from './services/musicLibrary';
import { useIPCListeners } from './hooks/useIPC';
import { useMediaKeybinds } from './hooks/useMediaKeybinds';
import { useTouchBar } from './hooks/useTouchBar';
import { useMediaSession } from './hooks/useMediaSession';
import BackgroundLayer from './components/BackgroundLayer';
import LoadingOverlay from './components/LoadingOverlay';
import AudioVisualizer from './components/AudioVisualizer';
import ImmersiveStarfield from './components/ImmersiveStarfield';
import AudioEngine from './components/AudioEngine';
import SongProgressBar from './components/SongProgressBar';
import DisclaimerModal, { agreed } from './components/DisclaimerModal';
import { Welcome, welcomed } from './components/GuideModal';
import MiniPlayer from './components/MiniPlayer';
import NewMediaToast from './components/NewMediaToast';
import DownloadView from './views/DownloadView';
import HomeView from './views/HomeView';
import SettingsModal from './components/SettingsModal';
import DebugConsole from './components/DebugConsole';

function useLiteModeClasses() {
  const isLite = useAppStore((s) => s.renderProfile === 'lite');
  const blur = useAppStore((s) => s.liteDisableBlur);
  const anim = useAppStore((s) => s.liteDisableAnimations);
  useEffect(() => {
    document.body.classList.toggle('lite-no-blur', isLite && blur);
    document.body.classList.toggle('lite-no-anim', isLite && anim);
  }, [isLite, blur, anim]);
}

// the look settings that are plain values, handed to the styles as variables on the page.
function useLookVariables() {
  const blur = useAppStore((s) => s.lookBlurIntensity);
  const dim = useAppStore((s) => s.lookBackgroundDim);
  const panels = useAppStore((s) => s.lookPanelOpacity);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--bg-blur', `${blur}px`);
    // half dimness is the original brightness, and the ends reach from fairly bright to nearly black.
    root.setProperty('--bg-brightness', String(0.6 - (dim / 100) * 0.5));
    root.setProperty('--panel-alpha', String(panels));
  }, [blur, dim, panels]);
}

function needsDisclaimer(view) {
  return !agreed(view);
}

// how long the old screen takes to fade out, and the new one to fade in.
const FADE_MS = 250;

// the screen navigation and the music point at right now.
function targetScreen(s) {
  return s.nextView === 'player' && wantsFolderScreen(s) ? 'folders' : s.nextView;
}

function ViewContent({ view }) {
  if (view === 'home') return <HomeView />;
  return <DownloadView />;
}

export default function App() {
  useIPCListeners();
  useLiteModeClasses();
  useLookVariables();
  useMediaKeybinds();
  useTouchBar();
  useMediaSession();

  const nextView = useAppStore((s) => s.nextView);
  const currentView = useAppStore((s) => s.currentView);
  const target = useAppStore(targetScreen);
  const shown = useAppStore((s) => (s.folderScreen ? 'folders' : s.currentView));
  const [fading, setFading] = useState(false);
  const [disclaimer, setDisclaimer] = useState(null);
  const [welcome, setWelcome] = useState(null);
  const fadingSince = useRef(null);

  // folders made in the downstream folder since the last launch join the library.
  useEffect(() => {
    syncNativeFolders();
    loadDeleted();
  }, []);

  useEffect(() => {
    setDisclaimer(needsDisclaimer(nextView) ? nextView : null);
  }, [nextView]);

  // every change of screen fades the old one out, swaps while nothing shows, then fades the new one in.
  // that covers going between views both ways, and the player's folder screen.
  // a change of mind halfway keeps the time already spent fading out.
  // a view still waiting on its disclaimer stays put, and accepting it clears disclaimer, which runs this again.
  useEffect(() => {
    if (needsDisclaimer(nextView) || target === shown) {
      fadingSince.current = null;
      setFading(false);
      return;
    }
    fadingSince.current ??= performance.now();
    setFading(true);
    const instant = document.body.classList.contains('lite-no-anim');
    const left = instant ? 0 : FADE_MS - (performance.now() - fadingSince.current);
    const t = setTimeout(() => {
      fadingSince.current = null;
      useAppStore.getState().showScreen(target);
      setFading(false);
    }, Math.max(0, left));
    return () => clearTimeout(t);
  }, [nextView, target, shown, disclaimer]);

  return (
    <>
      <BackgroundLayer />
      <ImmersiveStarfield />
      <SongProgressBar />
      <AudioEngine />
      <AudioVisualizer />
      <MiniPlayer heading={fading ? nextView : null} />
      <div className={`view-transition${fading ? ' view-fade-out' : ' view-fade-in'}`}>
        <ViewContent view={currentView} />
      </div>
      {disclaimer && (
        <DisclaimerModal
          type={disclaimer}
          onAccept={() => {
            const view = disclaimer;
            setDisclaimer(null);
            if (!welcomed(view)) setWelcome(view);
          }}
        />
      )}
      {welcome && <Welcome area={welcome} onDone={() => setWelcome(null)} />}
      <NewMediaToast />
      <SettingsModal />
      <LoadingOverlay />
      <DebugConsole />
    </>
  );
}
