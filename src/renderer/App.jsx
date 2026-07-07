import { useState, useEffect, useRef } from 'react';
import useAppStore from './stores/useAppStore';
import { useIPCListeners } from './hooks/useIPC';
import { useMediaKeybinds } from './hooks/useMediaKeybinds';
import BackgroundLayer from './components/BackgroundLayer';
import LoadingOverlay from './components/LoadingOverlay';
import AudioVisualizer from './components/AudioVisualizer';
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

function ViewContent({ view }) {
  if (view === 'home') return <HomeView />;
  return <DownloadView />;
}

export default function App() {
  useIPCListeners();
  useLiteModeClasses();
  useMediaKeybinds();

  const currentView = useAppStore((s) => s.currentView);
  const [displayed, setDisplayed] = useState(currentView);
  const [fading, setFading] = useState(false);
  const [disclaimer, setDisclaimer] = useState(null);
  const [guide, setGuide] = useState(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (needsDisclaimer(currentView)) {
      setDisclaimer(currentView);
      return;
    }
    setDisclaimer(null);

    if (firstRender.current) {
      firstRender.current = false;
      setDisplayed(currentView);
      return;
    }
    if (currentView === displayed) return;

    // going home skips fade-out so DownloadView never flashes.
    // homeView handles its own reveal animation via contentStyle.
    if (currentView === 'home') {
      setDisplayed('home');
      return;
    }

    setFading(true);
    const t = setTimeout(() => {
      setDisplayed(currentView);
      setFading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [currentView]);

  useEffect(() => {
    if (disclaimer === null && currentView !== displayed) {
      setFading(true);
      const t = setTimeout(() => {
        setDisplayed(currentView);
        setFading(false);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [disclaimer]);

  return (
    <>
      <BackgroundLayer />
      <SongProgressBar />
      <AudioEngine />
      <AudioVisualizer />
      <MiniPlayer />
      <div className={`view-transition${fading ? ' view-fade-out' : ' view-fade-in'}`}>
        <ViewContent view={displayed} />
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
