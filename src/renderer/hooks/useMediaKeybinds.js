import { useEffect } from 'react';
import useAppStore from '../stores/useAppStore';

const SEEK_STEP = 5;      // seconds, per ArrowLeft/ArrowRight press
const VOLUME_STEP = 0.05; // 0-1 scale, per ArrowUp/ArrowDown press

// text fields and range inputs (eq bands, the volume slider itself) get their native key behavior instead of being hijacked, which also covers shift+arrow text selection while typing.
function isTypingContext(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// a deliberately keyboard-focused button/link should still activate on space like normal (e.g. tab to "got it!" and press space).
// buttons also stay focused after a plain mouse click, and that leftover focus shouldn't hijack a later space press meant for play/pause and turn it into another skip.
// :focus-visible tells these apart: true for keyboard-driven focus, false for a focus that only exists because of a prior mouse click.
function isInteractiveFocus(el) {
  if (!el) return false;
  const isButtonish = el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute?.('role') === 'button';
  if (!isButtonish) return false;
  return typeof el.matches === 'function' && el.matches(':focus-visible');
}

export function useMediaKeybinds() {
  useEffect(() => {
    const onKeyDown = (e) => {
      const active = document.activeElement;
      if (isTypingContext(active)) return;

      const { musicCurrent, musicPlaying, musicVolume, musicAudioRef } = useAppStore.getState();
      if (!musicCurrent) return;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          if (isInteractiveFocus(active)) return;
          e.preventDefault();
          useAppStore.getState().setMusicPlaying(!musicPlaying);
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            useAppStore.getState().playPrevTrack();
          } else {
            const audio = musicAudioRef?.current;
            if (audio) audio.currentTime = Math.max(0, audio.currentTime - SEEK_STEP);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            useAppStore.getState().playNextTrack();
          } else {
            const audio = musicAudioRef?.current;
            if (audio) {
              const duration = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + SEEK_STEP;
              audio.currentTime = Math.min(duration, audio.currentTime + SEEK_STEP);
            }
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          useAppStore.getState().setMusicVolume(Math.min(1, musicVolume + VOLUME_STEP));
          break;

        case 'ArrowDown':
          e.preventDefault();
          useAppStore.getState().setMusicVolume(Math.max(0, musicVolume - VOLUME_STEP));
          break;

        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
