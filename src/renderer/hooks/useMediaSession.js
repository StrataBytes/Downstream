import { useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { sourceName } from '../services/musicLibrary';

// the system's own media controls: gnome's top bar and media keys on linux, now playing on macos, the media flyout on windows.
// chromium hands them what's set here, and runs their buttons through the player instead of pausing the audio behind its back.

const ACTIONS = {
  play: (s) => { if (s.musicCurrent) s.setMusicPlaying(true); },
  pause: (s) => s.setMusicPlaying(false),
  stop: (s) => s.setMusicPlaying(false),
  nexttrack: (s) => s.playNextTrack(),
  previoustrack: (s) => s.playPrevTrack(),
  seekto: (s, details) => {
    const audio = s.musicAudioRef?.current;
    if (audio && Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime;
  },
};

function setAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch { /* an action this chromium doesn't know */ }
}

export function useMediaSession() {
  const musicCurrent = useAppStore((s) => s.musicCurrent);
  const musicFolder = useAppStore((s) => s.musicFolder);
  const musicPlaying = useAppStore((s) => s.musicPlaying);

  useEffect(() => {
    if (!navigator.mediaSession) return undefined;
    Object.entries(ACTIONS).forEach(([action, run]) => setAction(action, (details) => run(useAppStore.getState(), details)));
    return () => Object.keys(ACTIONS).forEach((action) => setAction(action, null));
  }, []);

  // the song, the folder or mixtape it's playing from, and its cover once it's read.
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return undefined;
    if (!musicCurrent) {
      session.metadata = null;
      return undefined;
    }
    const about = { title: musicCurrent.name, artist: musicFolder ? sourceName(musicFolder) : '' };
    session.metadata = new MediaMetadata(about);
    let cancelled = false;
    if (!/\.mp4$/i.test(musicCurrent.path)) {
      window.electronAPI.getAlbumArt(musicCurrent.path).then((art) => {
        if (!cancelled && art) session.metadata = new MediaMetadata({ ...about, artwork: [{ src: art }] });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [musicCurrent, musicFolder]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.playbackState = !musicCurrent ? 'none' : musicPlaying ? 'playing' : 'paused';
  }, [musicCurrent, musicPlaying]);
}
