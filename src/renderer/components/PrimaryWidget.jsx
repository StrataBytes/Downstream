import useAppStore from '../stores/useAppStore';
import InputBar from './InputBar';
import NowPlaying from './NowPlaying';
import MusicPlayer from './MusicPlayer';

export default function PrimaryWidget() {
  const currentView = useAppStore((s) => s.currentView);

  return (
    <div className="primary-widget">
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
