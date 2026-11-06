import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { readSource, sourceName } from '../services/musicLibrary';
import { dbg } from '../services/debugLog';

const POLL_INTERVAL = 15000;
const TOAST_TIME = 4500;
const TOAST_FADE = 300;
// a new file that changed this recently may still be on its way in, from a copy or another app, so it waits for the next look.
const SETTLE_MS = 5000;

// keeps the playing source in step with its folders, adding new songs and dropping removed ones without stopping anything.
// a toast says when new media came in, or when a song was skipped because it couldn't be read.
export default function NewMediaToast() {
  const musicFolder = useAppStore((s) => s.musicFolder);
  const playing = useAppStore((s) => !!s.musicCurrent);
  const watchEnabled = useAppStore((s) => s.behaviorWatchFolder);
  const added = useAppStore((s) => s.newMediaAdded);
  const skipped = useAppStore((s) => s.skippedTrack);
  // the ambient home's menu sits in the bottom left corner, so there it shows in the top left instead.
  const up = useAppStore((s) => s.currentView === 'home' && !s.homeOriginal);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!watchEnabled || !musicFolder || !playing) return;
    const interval = setInterval(async () => {
      const files = await readSource(musicFolder);
      const s = useAppStore.getState();
      // an unplugged drive reads as empty, which shouldn't empty what's playing.
      if (s.musicFolder !== musicFolder || !s.musicCurrent || files.length === 0) return;
      const known = new Set(s.musicFiles.map((f) => f.path));
      const now = new Set(files.map((f) => f.path));
      const settled = files.filter((f) => known.has(f.path) || Date.now() - f.mtime > SETTLE_MS);
      const fresh = settled.filter((f) => !known.has(f.path)).length;
      const removed = s.musicFiles.filter((f) => !now.has(f.path)).length;
      if (!fresh && !removed) return;
      dbg('library', `playing source changed: ${fresh} added, ${removed} removed`);
      // a playing song whose file is gone can't finish, so playback moves on to what would have come next.
      // one moved out of the source from inside downstream plays on from its new place.
      const lost = !now.has(s.musicCurrent.path) && !s.musicCurrent.movedOut;
      const after = s.musicFiles.slice(s.musicFiles.findIndex((f) => f.path === s.musicCurrent.path) + 1);
      const nextInFolder = after.find((f) => now.has(f.path)) || settled[0];
      s.mergeMusicFiles(settled);
      if (lost && nextInFolder) {
        dbg('player', `"${s.musicCurrent.name}" was removed while playing, moving on`);
        if (s.musicShuffle) useAppStore.getState().playNextTrack();
        else useAppStore.getState().setMusicCurrent(settled.find((f) => f.path === nextInFolder.path));
      }
      if (fresh) s.setNewMediaAdded({ count: fresh, source: sourceName(musicFolder), at: Date.now() });
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [watchEnabled, musicFolder, playing]);

  // the newest of the two is the one shown.
  const notice = added && (!skipped || added.at >= skipped.at)
    ? { kind: 'added', ...added }
    : skipped && { kind: 'skipped', ...skipped };

  // each one shows for a few seconds before it slides away.
  useEffect(() => {
    if (!notice) return;
    setLeaving(false);
    const fade = setTimeout(() => setLeaving(true), TOAST_TIME);
    const clear = setTimeout(() => {
      useAppStore.getState().setNewMediaAdded(null);
      useAppStore.getState().setSkippedTrack(null);
    }, TOAST_TIME + TOAST_FADE);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [notice?.at]);

  if (!notice) return null;

  return (
    <div className={`new-media-toast${notice.kind === 'skipped' ? ' new-media-toast-skipped' : ''}${up ? ' new-media-toast-up' : ''}${leaving ? ' new-media-toast-leaving' : ''}`} role="status">
      {notice.kind === 'added' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      )}
      <div className="new-media-toast-text">
        <span className="new-media-toast-title">{notice.kind === 'added' ? 'New media added' : notice.stopped ? "Couldn't play a song" : 'Skipped a song'}</span>
        <span className="new-media-toast-desc">
          {notice.kind === 'added'
            ? `${notice.count} new track${notice.count === 1 ? '' : 's'} in ${notice.source}`
            : `"${notice.name}" looks damaged or unfinished`}
        </span>
      </div>
    </div>
  );
}
