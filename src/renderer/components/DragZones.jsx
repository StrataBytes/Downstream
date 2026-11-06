import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TEMP, LIBRARY, folderName } from '../services/musicLibrary';
import { Cover, Mosaic, PinIcon, TapeGlyph } from './FolderGrid';
import { PlusIcon } from './InputBar';

// the space kept between the zones and the main panel, and from the window's edge.
const GAP = 10;
const EDGE = 8;

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4h6v2" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 4 8" />
      <line x1="8" y1="12" x2="12" y2="12" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

// while a folder is dragged, places to drop it around the main panel: what can be done to it on the left, and the mixtapes below.
// media dragged out of a folder gets the same, with delete on the left and the folders it can move to below.
// they sit outside the panel when there's room, and come in over its edges when there isn't.
// each sits on a matte plate, quieter than the panel, which stays the focus.
export default function DragZones({ anchor, folder, from, native, tapes, media, onDrop }) {
  const [over, setOver] = useState(null);
  const [place, setPlace] = useState(null);
  const sideRef = useRef(null);
  const belowRef = useRef(null);

  useLayoutEffect(() => {
    const side = sideRef.current.offsetWidth;
    const below = belowRef.current.offsetHeight;
    const roomLeft = anchor.left - GAP - side >= EDGE;
    const roomBelow = window.innerHeight - anchor.bottom - GAP - below >= EDGE;
    setPlace({
      side: { left: roomLeft ? anchor.left - GAP - side : anchor.left + 12, top: anchor.top + anchor.height / 2 },
      sideInside: !roomLeft,
      below: {
        left: anchor.left + anchor.width / 2,
        maxWidth: anchor.width - (roomBelow ? 0 : 24),
        top: roomBelow ? anchor.bottom + GAP : anchor.bottom - 12 - below,
      },
      belowInside: !roomBelow,
    });
  }, [anchor]);

  // the plates turn teal around the dragged folder as it comes near, following it.
  // the point is set straight on each plate, so following it doesn't redraw the zones.
  useEffect(() => {
    let frame = null;
    let at = null;
    const paint = () => {
      frame = null;
      [sideRef.current, belowRef.current].forEach((plate) => {
        if (!plate) return;
        const r = plate.getBoundingClientRect();
        plate.style.setProperty('--near-x', `${at.x - r.left}px`);
        plate.style.setProperty('--near-y', `${at.y - r.top}px`);
      });
    };
    const follow = (e) => {
      at = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener('dragover', follow);
    return () => {
      window.removeEventListener('dragover', follow);
      cancelAnimationFrame(frame);
    };
  }, []);

  const target = (id) => ({
    onDragEnter: (e) => {
      e.preventDefault();
      setOver(id);
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === id ? null : o));
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      onDrop(id, e.currentTarget.getBoundingClientRect());
    },
    className: `folders-zone-target${over === id ? ' folders-zone-target-over' : ''}`,
  });

  const hidden = place ? null : { visibility: 'hidden' };

  if (media) {
    const here = (f) => media.here.includes(f.path);
    return createPortal(
      <>
        <div ref={sideRef} className={`folders-zone folders-zone-side${place?.sideInside ? ' folders-zone-inside' : ''}`} style={{ ...place?.side, ...hidden }}>
          <div className="folders-zone-inner">
            <div {...target('trash')} data-danger>
              <TrashIcon />
              <span>Delete</span>
            </div>
          </div>
        </div>
        {/* the row wraps, so it's measured at the width it'll have, which decides whether it fits below the panel. */}
        <div ref={belowRef} className={`folders-zone folders-zone-below folders-zone-media${place?.belowInside ? ' folders-zone-inside' : ''}`} style={{ left: anchor.left + anchor.width / 2, maxWidth: anchor.width, ...place?.below, ...hidden }}>
          <div className="folders-zone-inner">
            <div {...target('new')}>
              <span className="folders-zone-tape-icon"><PlusIcon size={14} /></span>
              <span>New folder</span>
            </div>
            {media.folders.filter((f) => !here(f)).map((f) => (
              <div key={f.path} {...target(`folder:${f.path}`)} title={folderName(f)}>
                <Cover folder={f} />
                <span className="folders-zone-name">{folderName(f)}</span>
              </div>
            ))}
            {media.folders.some(here) && (
              <div className="folders-zone-already">
                <span className="folders-zone-label">Already in</span>
                {media.folders.filter(here).map((f) => (
                  <div key={f.path} className="folders-zone-target folders-zone-target-off" title={folderName(f)}>
                    <Cover folder={f} />
                    <span className="folders-zone-name">{folderName(f)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  const fromTape = from !== LIBRARY && tapes.find((t) => t.id === from);
  const holds = (t) => t.paths.includes(folder.path);
  const open = tapes.filter((t) => !holds(t));
  const already = tapes.filter(holds);

  return createPortal(
    <>
      <div ref={sideRef} className={`folders-zone folders-zone-side${place?.sideInside ? ' folders-zone-inside' : ''}`} style={{ ...place?.side, ...hidden }}>
        <div className="folders-zone-inner">
          {fromTape ? (
            <div {...target('leave')} data-danger>
              <UnlinkIcon />
              <span>Remove from {fromTape.name}</span>
            </div>
          ) : (
            <>
              {native ? (
                <div {...target('trash')} data-danger>
                  <TrashIcon />
                  <span>Delete</span>
                </div>
              ) : (
                <div {...target('remove')} data-danger>
                  <UnlinkIcon />
                  <span>Remove from library</span>
                </div>
              )}
              <div {...target('pin')}>
                <PinIcon size={16} />
                <span>{folder.pinned ? 'Unpin' : 'Pin to top'}</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div ref={belowRef} className={`folders-zone folders-zone-below${place?.belowInside ? ' folders-zone-inside' : ''}`} style={{ ...place?.below, ...hidden }}>
        <div className="folders-zone-inner">
          <div {...target('new')}>
            <span className="folders-zone-tape-icon"><PlusIcon size={14} /></span>
            <span>New mixtape</span>
          </div>
          {open.map((t) => (
            <div key={t.id} {...target(`tape:${t.id}`)} title={t.name}>
              {t.id === TEMP && !t.folders.length ? <span className="folders-zone-tape-icon"><TapeGlyph size={14} /></span> : <Mosaic folders={t.folders} size="small" />}
              <span className="folders-zone-name">{t.name}</span>
            </div>
          ))}
          {already.length > 0 && (
            <div className="folders-zone-already">
              <span className="folders-zone-label">Already on</span>
              {already.map((t) => (
                <div key={t.id} className="folders-zone-target folders-zone-target-off" title={t.name}>
                  <Mosaic folders={t.folders} size="small" />
                  <span className="folders-zone-name">{t.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
