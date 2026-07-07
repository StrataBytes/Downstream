import { useRef, useEffect, useState, useCallback } from 'react';
import useAppStore from '../stores/useAppStore';

export default function SongProgressBar() {
  const audioRef = useAppStore((s) => s.musicAudioRef);
  const musicCurrent = useAppStore((s) => s.musicCurrent);

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const rafRef = useRef(null);
  const goneCountRef = useRef(0);

  useEffect(() => {
    goneCountRef.current = 0;

    const tick = () => {
      const audio = audioRef?.current;
      if (audio && audio.duration > 0 && !isNaN(audio.duration) && audio.src) {
        setProgress(audio.currentTime / audio.duration);
        goneCountRef.current = 0;
        if (!visible) setVisible(true);
      } else {
        goneCountRef.current++;
        if (goneCountRef.current > 120) {
          setVisible(false);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioRef, musicCurrent]);

  // surfaces "still fetching data" (post-seek disk/stream buffering, or the media element confirming the file is actually there) as a shimmer on the filled portion, rather than the bar silently freezing mid-scrub.
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    const onWaiting = () => setBuffering(true);
    const onResume = () => setBuffering(false);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onResume);
    audio.addEventListener('canplaythrough', onResume);
    audio.addEventListener('pause', onResume);
    return () => {
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onResume);
      audio.removeEventListener('canplaythrough', onResume);
      audio.removeEventListener('pause', onResume);
    };
  }, [audioRef, musicCurrent]);

  const handleClick = useCallback((e) => {
    const audio = audioRef?.current;
    if (!audio || !audio.duration || isNaN(audio.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }, [audioRef]);

  const hidden = useAppStore((s) => s.behaviorHideProgressBar);

  if (!visible || hidden) return null;

  return (
    <div className="song-progress-bar" onClick={handleClick}>
      <div
        className={`song-progress-fill${buffering ? ' song-progress-buffering' : ''}`}
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
