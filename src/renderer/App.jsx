import { useState, useEffect, useRef } from 'react';
import useAppStore from './stores/useAppStore';
import { useIPCListeners } from './hooks/useIPC';
import BackgroundLayer from './components/BackgroundLayer';
import LoadingOverlay from './components/LoadingOverlay';
import AudioVisualizer from './components/AudioVisualizer';
import AudioEngine from './components/AudioEngine';
import SongProgressBar from './components/SongProgressBar';
import DisclaimerModal from './components/DisclaimerModal';
import DownloadView from './views/DownloadView';
import HomeView from './views/HomeView';

function needsDisclaimer(view) {
  if (view === 'download') return !localStorage.getItem('disclaimerDownloadAccepted');
  if (view === 'player') return !localStorage.getItem('disclaimerPlayerAccepted');
  return false;
}

function ViewContent({ view }) {
  if (view === 'home') return <HomeView />;
  return <DownloadView />;
}

export default function App() {
  useIPCListeners();

  const currentView = useAppStore((s) => s.currentView);
  const [displayed, setDisplayed] = useState(currentView);
  const [fading, setFading] = useState(false);
  const [disclaimer, setDisclaimer] = useState(null);
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
      <div className={`view-transition${fading ? ' view-fade-out' : ' view-fade-in'}`}>
        <ViewContent view={displayed} />
      </div>
      {disclaimer && <DisclaimerModal type={disclaimer} onAccept={() => setDisclaimer(null)} />}
      <LoadingOverlay />
    </>
  );
}
