import { useState, useEffect, useRef } from 'react';
import useAppStore from './stores/useAppStore';
import { wantsFolderScreen } from './services/musicLibrary';
import { useIPCListeners } from './hooks/useIPC';
import { useMediaKeybinds } from './hooks/useMediaKeybinds';
import { useTouchBar } from './hooks/useTouchBar';
import BackgroundLayer from './components/BackgroundLayer';
import LoadingOverlay from './components/LoadingOverlay';
import AudioVisualizer from './components/AudioVisualizer';
import ImmersiveStarfield from './components/ImmersiveStarfield';
import AudioEngine from './components/AudioEngine';
import SongProgressBar from './components/SongProgressBar';
import DisclaimerModal from './components/DisclaimerModal';
import GuideModal from './components/GuideModal';
import MiniPlayer from './components/MiniPlayer';
import NewFilesPopup from './components/NewFilesPopup';
import DownloadView from './views/DownloadView';
import HomeView from './views/HomeView';
import OptionsModal from './components/OptionsModal';
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

function needsDisclaimer(view) {
  if (view === 'download') return !localStorage.getItem('disclaimerDownloadAccepted');
  if (view === 'player') return !localStorage.getItem('disclaimerPlayerAccepted');
  return false;
}

function needsGuide(view) {
  if (view === 'download') return !localStorage.getItem('guideDownloadSeen');
  if (view === 'player') return !localStorage.getItem('guidePlayerSeen');
  return false;
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
  useMediaKeybinds();
  useTouchBar();

  const nextView = useAppStore((s) => s.nextView);
  const currentView = useAppStore((s) => s.currentView);
  const target = useAppStore(targetScreen);
  const shown = useAppStore((s) => (s.folderScreen ? 'folders' : s.currentView));
  const [fading, setFading] = useState(false);
  const [disclaimer, setDisclaimer] = useState(null);
  const [guide, setGuide] = useState(null);
  const fadingSince = useRef(null);

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
      <MiniPlayer leaving={fading && nextView === 'player'} />
      <div className={`view-transition${fading ? ' view-fade-out' : ' view-fade-in'}`}>
        <ViewContent view={currentView} />
      </div>
      {disclaimer && (
        <DisclaimerModal
          type={disclaimer}
          onAccept={() => {
            const view = disclaimer;
            setDisclaimer(null);
            if (needsGuide(view)) setGuide(view);
          }}
        />
      )}
      {guide && <GuideModal type={guide} onDismiss={() => setGuide(null)} />}
      <NewFilesPopup />
      <OptionsModal />
      <LoadingOverlay />
      <DebugConsole />
    </>
  );
}
