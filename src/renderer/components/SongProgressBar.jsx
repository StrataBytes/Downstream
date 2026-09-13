import { useRef, useEffect, useState, useCallback } from 'react';
import useAppStore from '../stores/useAppStore';

function hasUsableDuration(audio) {
  return Number.isFinite(audio?.duration) && audio.duration > 0;
}

function formatSeekTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

const PREPARE_SHIMMER_DELAY = 350;
const SHIMMER_EXIT_DURATION = 360;

export default function SongProgressBar() {
  const audioRef = useAppStore((s) => s.musicAudioRef);
  const musicCurrent = useAppStore((s) => s.musicCurrent);

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [shimmerPhase, setShimmerPhaseState] = useState('off');
  const [seekPreview, setSeekPreview] = useState(null);
  const rafRef = useRef(null);
  const goneCountRef = useRef(0);
  const lastProgressRef = useRef(-1);
  const barRef = useRef(null);
  const preparingRef = useRef(false);
  const shimmerPhaseRef = useRef('off');
  const shimmerDelayRef = useRef(null);
  const shimmerExitRef = useRef(null);
  const draggingRef = useRef(false);
  const dragPointerIdRef = useRef(null);
  const dragRafRef = useRef(null);
  const pendingDragXRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const setShimmerPhase = (phase) => {
    shimmerPhaseRef.current = phase;
    setShimmerPhaseState(phase);
  };

  const clearShimmerTimers = () => {
    clearTimeout(shimmerDelayRef.current);
    clearTimeout(shimmerExitRef.current);
  };

  const beginPreparation = () => {
    preparingRef.current = true;
    clearShimmerTimers();
    setShimmerPhase('waiting');
    // Near-instant loads should remain visually quiet. Only show the sweep when
    // metadata has genuinely taken long enough for users to notice.
    shimmerDelayRef.current = setTimeout(() => {
      if (preparingRef.current) setShimmerPhase('active');
    }, PREPARE_SHIMMER_DELAY);
  };

  const finishPreparation = () => {
    if (!preparingRef.current) return;
    preparingRef.current = false;
    clearTimeout(shimmerDelayRef.current);

    if (shimmerPhaseRef.current === 'active') {
      // Preserve the running sweep's current position, then let it finish its trip
      // to the right while fading instead of snapping out halfway across the bar.
      const position = barRef.current && getComputedStyle(barRef.current, '::after').backgroundPosition;
      if (position) barRef.current.style.setProperty('--song-progress-shimmer-position', position);
      setShimmerPhase('exiting');
      shimmerExitRef.current = setTimeout(() => setShimmerPhase('off'), SHIMMER_EXIT_DURATION);
    } else {
      setShimmerPhase('off');
    }
  };

  const stopPreparationImmediately = () => {
    preparingRef.current = false;
    clearShimmerTimers();
    setShimmerPhase('off');
  };

  useEffect(() => () => {
    clearShimmerTimers();
    cancelAnimationFrame(dragRafRef.current);
  }, []);

  useEffect(() => {
    goneCountRef.current = 0;
    lastProgressRef.current = -1;

    const tick = () => {
      const audio = audioRef?.current;
      if (audio?.src) {
        if (hasUsableDuration(audio) && Number.isFinite(audio.currentTime)) {
          // Some long media files report Infinity or unstable metadata while the
          // container is being indexed. Never pass NaN/Infinity through to CSS.
          const next = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
          // A pixel-scale update is visually indistinguishable from every animation
          // frame, while avoiding 60 React renders per second on huge media files.
          if (Math.abs(next - lastProgressRef.current) >= 0.0005) {
            lastProgressRef.current = next;
            setProgress(next);
          }
        } else if (lastProgressRef.current !== 0) {
          lastProgressRef.current = 0;
          setProgress(0);
        }
        goneCountRef.current = 0;
      } else {
        goneCountRef.current++;
        if (!musicCurrent && goneCountRef.current > 120) {
          setVisible(false);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioRef, musicCurrent]);

  // Surface both normal buffering and the initial metadata/indexing phase. The
  // latter has no filled progress yet, so the track itself receives the shimmer.
  useEffect(() => {
    const audio = audioRef?.current;
    if (!musicCurrent) {
      stopPreparationImmediately();
      setBuffering(false);
      return;
    }

    setVisible(true);
    setProgress(0);
    lastProgressRef.current = -1;
    beginPreparation();
    setBuffering(false);
    if (!audio) return;

    const onWaiting = () => setBuffering(true);
    const onLoadStart = () => {
      beginPreparation();
      setBuffering(false);
      setProgress(0);
      lastProgressRef.current = -1;
    };
    const onReady = () => {
      setBuffering(false);
      if (hasUsableDuration(audio)) finishPreparation();
    };
    const onError = () => {
      finishPreparation();
      setBuffering(false);
    };

    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onReady);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('loadedmetadata', onReady);
    audio.addEventListener('durationchange', onReady);
    audio.addEventListener('error', onError);
    // AudioEngine updates src in its own effect. Check on the next task so this
    // observes the newly selected element rather than a just-replaced previous one.
    const initialCheck = setTimeout(onReady, 0);
    return () => {
      clearTimeout(initialCheck);
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('durationchange', onReady);
      audio.removeEventListener('error', onError);
    };
  }, [audioRef, musicCurrent]);

  const getSeekPosition = useCallback((clientX) => {
    const audio = audioRef?.current;
    const rect = barRef.current?.getBoundingClientRect();
    if (!hasUsableDuration(audio) || !rect?.width) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return { audio, ratio };
  }, [audioRef]);

  const previewSeekPosition = useCallback((clientX) => {
    const position = getSeekPosition(clientX);
    if (!position) {
      setSeekPreview(null);
      return null;
    }
    const x = Math.max(4, Math.min(96, position.ratio * 100));
    setSeekPreview({ x, label: formatSeekTime(position.ratio * position.audio.duration) });
    return position;
  }, [getSeekPosition]);

  const seekToPointer = useCallback((clientX) => {
    const position = previewSeekPosition(clientX);
    if (!position) return;
    const { audio, ratio } = position;
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }, [previewSeekPosition]);

  const handlePointerMove = useCallback((e) => {
    if (!draggingRef.current) {
      previewSeekPosition(e.clientX);
      return;
    }
    if (e.pointerId !== dragPointerIdRef.current) return;
    pendingDragXRef.current = e.clientX;
    if (!dragRafRef.current) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        if (draggingRef.current) seekToPointer(pendingDragXRef.current);
      });
    }
  }, [previewSeekPosition, seekToPointer]);

  const handlePointerDown = useCallback((e) => {
    if (!getSeekPosition(e.clientX)) return;
    e.preventDefault();
    draggingRef.current = true;
    dragPointerIdRef.current = e.pointerId;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToPointer(e.clientX);
  }, [getSeekPosition, seekToPointer]);

  const finishDrag = useCallback((e) => {
    if (!draggingRef.current || e.pointerId !== dragPointerIdRef.current) return;
    cancelAnimationFrame(dragRafRef.current);
    dragRafRef.current = null;
    if (e.type !== 'pointercancel') {
      seekToPointer(e.clientX);
    }
    draggingRef.current = false;
    dragPointerIdRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [seekToPointer]);

  const hidden = useAppStore((s) => s.behaviorHideProgressBar);
  const emptyShimmer = shimmerPhase === 'active' || (buffering && progress <= 0);
  const shimmerExiting = shimmerPhase === 'exiting';

  if (!visible || hidden) return null;

  return (
    <div
      ref={barRef}
      className={`song-progress-bar${emptyShimmer ? ' song-progress-preparing' : ''}${shimmerExiting ? ' song-progress-preparing-exit' : ''}${dragging ? ' song-progress-dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onPointerLeave={() => { if (!draggingRef.current) setSeekPreview(null); }}
    >
      <div
        className={`song-progress-fill${buffering ? ' song-progress-buffering' : ''}`}
        style={{ width: `${progress * 100}%` }}
      />
      {seekPreview && (
        <span className="song-progress-preview" style={{ left: `${seekPreview.x}%` }}>
          {seekPreview.label}
        </span>
      )}
    </div>
  );
}
