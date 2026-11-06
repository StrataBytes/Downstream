import { useEffect, useMemo, useRef, useState } from 'react';
import useAppStore, { queueItemWaiting } from '../stores/useAppStore';
import { downloadAll, chooseDownloadFolder } from '../services/downloadService';
import { baseName, isNative, createFolder, syncNativeFolders } from '../services/musicLibrary';
import { counts, useLibraryDetails, FolderCard, FolderGlyph, NameInput, folderMeta } from './FolderGrid';
import { DownloadIcon, PlusIcon } from './InputBar';

const byName = (a, b) => baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true, sensitivity: 'base' });

// where download all sends the batch: the downloads folder, a folder in downstream, which the player knows about too, or anywhere else.
// it starts on the last place picked this session, so enter or one click starts the batch.
export default function SavePicker() {
  const library = useAppStore((s) => s.library);
  const nativeRoot = useAppStore((s) => s.nativeRoot);
  const last = useAppStore((s) => s.downloadFolder);
  const waiting = useAppStore((s) => s.queue.filter(queueItemWaiting).length);
  const setSavePickerOpen = useAppStore((s) => s.setSavePickerOpen);
  // null is the downloads folder.
  const [choice, setChoice] = useState(last);
  // a folder picked from anywhere else, shown beside the downloads folder.
  const [other, setOther] = useState(() => (last && !isNative(last, nativeRoot) ? last : null));
  const [naming, setNaming] = useState(false);
  const [problem, setProblem] = useState(null);
  const rootRef = useRef(null);

  const native = useMemo(() => library.folders.filter((f) => isNative(f.path, nativeRoot)).sort(byName), [library.folders, nativeRoot]);
  useLibraryDetails(useMemo(() => native.map((f) => f.path), [native]));
  const name = choice ? baseName(choice) : 'Downloads';

  useEffect(() => {
    syncNativeFolders();
    rootRef.current?.focus();
  }, []);

  const close = () => setSavePickerOpen(false);

  const start = (to = choice) => {
    if (useAppStore.getState().isDownloading) return;
    useAppStore.getState().setDownloadFolder(to);
    close();
    downloadAll();
  };

  const make = async (folderName) => {
    setNaming(false);
    if (folderName === null || !folderName.trim()) return;
    const res = await createFolder(folderName.trim());
    if (res.error) setProblem(res.error);
    else {
      setProblem(null);
      setChoice(res.path);
    }
  };

  const chooseElsewhere = async () => {
    const picked = await chooseDownloadFolder();
    if (!picked) return;
    if (!isNative(picked, nativeRoot)) setOther(picked);
    setChoice(picked);
  };

  const tile = (path) => ({
    onClick: () => setChoice(path),
    onDoubleClick: () => start(path),
  });

  return (
    <div
      ref={rootRef}
      className="save-picker"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (naming) return;
        if (e.key === 'Escape') close();
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') start();
      }}
    >
      <div className="save-picker-head">
        <h2>Save to</h2>
        <span className="queue-count">{waiting} {waiting === 1 ? 'download' : 'downloads'}</span>
      </div>

      <div className="folders-body">
        <div className="folders-list save-picker-list">
          <div className="folders-grid">
            <div role="button" tabIndex={0} className={`folder-card save-picker-downloads${choice === null ? ' folder-card-selected' : ''}`} title="Your computer's Downloads folder" {...tile(null)}>
              <span className="folder-cover"><DownloadIcon size={22} /></span>
              <span className="folder-card-name">Downloads</span>
              <span className="folder-card-meta">On your computer</span>
            </div>
            {other && (
              <div role="button" tabIndex={0} className={`folder-card folder-card-external${choice === other ? ' folder-card-selected' : ''}`} title={other} {...tile(other)}>
                <span className="folder-cover"><FolderGlyph /></span>
                <span className="folder-card-name">{baseName(other)}</span>
                <span className="folder-card-meta">Chosen this session</span>
              </div>
            )}
          </div>

          <div className="folders-heading">
            <span>In Downstream, where the player finds them</span>
            <span className="folders-divider-line" />
          </div>
          <div className="folders-grid">
            {native.filter((folder) => counts.get(folder.path) !== null).map((folder) => (
              <FolderCard
                key={folder.path}
                folder={folder}
                meta={folderMeta(folder)}
                className={choice === folder.path ? 'folder-card-selected' : ''}
                {...tile(folder.path)}
              />
            ))}
            {naming ? (
              <div className="folder-card">
                <span className="folder-cover"><FolderGlyph /></span>
                <NameInput value="" onDone={make} />
                <span className="folder-card-meta">Enter to make it</span>
              </div>
            ) : (
              <div role="button" tabIndex={0} className="folder-card folder-card-empty" onClick={() => setNaming(true)}>
                <PlusIcon size={18} />
                <span>New folder</span>
              </div>
            )}
          </div>
          {problem && <p className="folders-menu-text">{problem}</p>}
        </div>

        <div className="folders-footer">
          <span className="folders-footer-count">
            <button className="search-footer-clear save-picker-elsewhere" onClick={chooseElsewhere}>Choose a folder...</button>
          </span>
          <button className="folders-footer-btn" onClick={close}>Cancel</button>
          <button className="search-add folders-add" onClick={() => start()} title={choice || 'Your Downloads folder'}>
            {choice ? `Download to ${name}` : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
