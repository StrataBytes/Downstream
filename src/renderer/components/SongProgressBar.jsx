import { useRef, useEffect, useState, useCallback } from 'react';
import useAppStore from '../stores/useAppStore';

export default function SongProgressBar() {
  const audioRef = useAppStore((s) => s.musicAudioRef);

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const hasTrackRef = useRef(false);
  const rafRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      const audio = audioRef?.current;
      if (audio && audio.duration > 0 && audio.src) {
        setProgress(audio.currentTime / audio.duration);
        if (!hasTrackRef.current) {
          hasTrackRef.current = true;
          setVisible(true);
        }
      } else {
        if (hasTrackRef.current) {
          hasTrackRef.current = false;
          setVisible(false);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioRef]);

  const handleClick = useCallback((e) => {
    const audio = audioRef?.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }, [audioRef]);

  if (!visible) return null;

  return (
    <div className="song-progress-bar" onClick={handleClick}>
      <div
        className="song-progress-fill"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
