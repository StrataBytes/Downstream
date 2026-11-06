import { Fragment, useEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { entry, page as pageOf } from '../utils/settingsCatalog';
import { agreed } from './DisclaimerModal';
import { SearchScene, LinkScene, QueueScene, SaveScene, FoldersScene, MediaScene, MixtapeScene, PlayerScene, ChipsScene } from './GuideScenes';

const NAMES = { download: 'Downloader', player: 'Player' };

// what the system's file manager is called, and the key that adds to a selection, on this computer.
const FILE_MANAGER = { darwin: 'Finder', win32: 'File Explorer' }[window.electronAPI.platform] || 'Files';
const PICK_KEY = window.electronAPI.platform === 'darwin' ? 'Cmd' : 'Ctrl';

// each side's welcome plays once, the first time it's opened after its agreement.
const WELCOMED = { download: 'guideDownloadSeen', player: 'guidePlayerSeen' };

export const welcomed = (side) => !!localStorage.getItem(WELCOMED[side]);

const ICON_PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  tags: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><path d="M7.5 7.5h.01" /></>,
  remove: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <polygon points="6 4 20 12 6 20 6 4" />,
  pin: <path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  tape: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><circle cx="16" cy="11" r="2" /><path d="M6 19l2-4h8l2 4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shuffle: <><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></>,
  repeat: <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  level: <path d="M5 7v10M10 7v10M15 7v10M20 7v10" />,
  sound: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  device: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  update: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  tools: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  replay: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>,
  note: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  move: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M10 13h6M13.5 10.5 16 13l-2.5 2.5" /></>,
};

function Icon({ name, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

// the first look at each side, three steps long, ending on its first thing to do.
const WELCOME = {
  download: {
    done: 'Start downloading',
    steps: [
      { title: 'Find it', text: 'Search for anything, or paste a link to a video or a whole playlist. Tick what you want and add it to the queue.', Scene: SearchScene },
      { title: 'Line it up', text: 'Everything you add waits in the queue on the right. Change the quality or format of one item, or of all of them at once.', Scene: QueueScene },
      { title: 'Save it', text: 'Download All asks where the batch should go, then works through it one at a time while you keep browsing.', Scene: SaveScene },
    ],
  },
  player: {
    done: 'Start listening',
    steps: [
      { title: 'Pick a folder', text: 'Every folder of media is something to play. Make one here or add one of yours, then select it and press Play.', Scene: FoldersScene },
      { title: 'Press play', text: 'The controls, the volume and a row of chips sit together in the player. Each song is measured in the background, so they all play at about the same volume.', Scene: PlayerScene },
      { title: 'Make it yours', text: 'EQ shapes the sound, and Settings changes how the player looks and sounds.', Scene: ChipsScene },
    ],
  },
};

const GUIDE_HINT = 'The Guide, in the top left corner, has the rest whenever you want it.';

// what each side's guide covers, a picture of it first, then a short row for each thing to know.
// a row can lead to the setting it's about.
const PRIVACY = [
  ['device', 'Everything stays on your device', 'No accounts, no analytics and no tracking. Your downloads, library and listening never leave your computer.'],
  ['update', 'One connection, for updates', 'Downstream checks its public GitHub page for newer versions, and sends nothing about you.'],
  ['tools', 'Two open tools inside', 'FFmpeg and yt-dlp do the downloading and converting, and are kept up to date as needed.'],
  ['shield', 'Use it responsibly', "Only download or play what you own or have permission to use, and respect each site's terms. Downstream doesn't endorse piracy."],
];

const TOPICS = {
  download: [
    {
      id: 'find', name: 'Finding things', icon: 'search', Scene: SearchScene,
      rows: [
        ['search', 'Search', 'Type anything and press Enter. General, Music and Playlists each search their own way. Tick what you want, then add it all at once.'],
        ['link', 'Paste a link', 'A link to a video goes straight into the queue.'],
        ['list', 'Playlists and mixes', 'Public and unlisted playlists and radio mixes ask which of their videos to add.'],
      ],
    },
    {
      id: 'quality', name: 'Quality and format', icon: 'star', Scene: LinkScene,
      rows: [
        ['star', 'Quality', 'Picked before adding, from 480p up to the highest there is.'],
        ['film', 'MP4 or MP3', 'MP4 keeps the video. MP3 keeps just the sound.'],
        ['tags', 'Change them later', "An item's tags in the queue change it, until it starts."],
      ],
    },
    {
      id: 'queue', name: 'The queue', icon: 'list', Scene: QueueScene,
      rows: [
        ['tags', 'Set all', 'Changes the quality or format of everything still waiting.'],
        ['remove', 'Remove', 'The cross on an item takes it out before it starts.'],
        ['check', 'Completed', 'What finished this session moves to its own tab.'],
      ],
    },
    {
      id: 'save', name: 'Saving', icon: 'download', Scene: SaveScene,
      rows: [
        ['download', 'Download All', 'Asks where the batch goes: your Downloads folder, a folder in Downstream, a new one, or anywhere else.'],
        ['folder', 'Into the player', 'Folders in Downstream are where the player finds media, so anything saved there is ready to play.'],
        ['clock', 'Keep browsing', 'Downloads carry on while you use the rest of Downstream.'],
        ['tools', 'Skip the question', 'Always save to your Downloads folder instead.', 'askWhereToSave'],
      ],
    },
    { id: 'privacy', name: 'Privacy and use', icon: 'lock', rows: PRIVACY },
  ],
  player: [
    {
      id: 'folders', name: 'Folders', icon: 'folder', Scene: FoldersScene,
      rows: [
        ['plus', 'New folder', 'Makes a folder in the Downstream folder, inside your Music folder.'],
        ['folder', 'Add folders', 'Adds folders from anywhere, several at once. They stay where they are.'],
        ['play', 'Play', 'Double-click a folder, or open it and press Play.'],
        ['pin', 'Make it yours', "A folder's menu, or a right-click, can pin it, rename it or give it a color."],
        ['trash', 'Removing', 'A folder you added only leaves Downstream. A deleted Downstream folder waits in Recently deleted for 30 days.'],
        ['file', 'Which files play', 'MP3, FLAC, WAV and MP4. An MP4 plays its sound, with the video as a soft background.', 'acceptMp3'],
      ],
    },
    {
      id: 'media', name: 'Media', icon: 'note', Scene: MediaScene,
      rows: [
        ['note', 'Opening a folder', 'Click a folder to see its media, and the Folders tab or Escape to go back. Double-click a song to play from there.'],
        ['plus', 'Add media', `Add media brings in files from anywhere, or drop them on a folder from ${FILE_MANAGER}. Copy keeps the originals, and Move removes them.`],
        ['move', 'Move to', 'Tick songs, then press Move to, or drag them onto a folder in the row that comes up. A move leaves nothing behind.'],
        ['trash', 'Deleting', 'Deleted songs wait in Recently deleted for 30 days, and Undo brings anything straight back.'],
        ['search', 'Finding a song', 'The search at the top looks inside every folder too.'],
        ['list', 'While playing', `The library beside the player can move and delete songs too. Shift-click or ${PICK_KEY}-click picks several.`],
      ],
    },
    {
      id: 'mixtapes', name: 'Mixtapes', icon: 'tape', Scene: MixtapeScene,
      rows: [
        ['tape', 'Several folders as one', 'Drag a folder onto a mixtape in the row that comes up under the panel, or onto New mixtape to start one.'],
        ['list', 'From the menu', "A folder's menu can add it to a mixtape too."],
        ['clock', 'The temporary mixtape', "For a quick mix. It's gone when Downstream closes, unless you save it."],
      ],
    },
    {
      id: 'play', name: 'Playing', icon: 'play', Scene: PlayerScene, keys: true,
      rows: [
        ['shuffle', 'Shuffle', 'Plays every song once in a random order, then shuffles again.', 'behaviorShuffleOnStart'],
        ['repeat', 'Repeat', 'Plays the same song again and again.'],
        ['clock', 'Between songs', 'A short pause comes before a song that plays on its own, and new songs can fade in.', 'advanceDelay'],
      ],
    },
    {
      id: 'sound', name: 'Sound', icon: 'sound', Scene: ChipsScene, sceneProps: { parts: ['eq'] },
      rows: [
        ['sliders', 'EQ', 'Ten bands from 31 Hz to 16 kHz, with presets to start from. Changes to a preset are kept.'],
        ['level', 'Even volume', 'Each song is measured once in the background, then played at about the same loudness as the rest, so nothing is suddenly loud or quiet.', 'musicNormalize'],
      ],
    },
    { id: 'privacy', name: 'Privacy and use', icon: 'lock', rows: PRIVACY },
  ],
};

function Rows({ rows, onSetting }) {
  return (
    <div className="settings-rows">
      {rows.map(([icon, label, desc, setting]) => (
        <div key={label} className="settings-row guide-row">
          <span className="guide-row-icon"><Icon name={icon} /></span>
          <span className="settings-row-info">
            <span className="settings-row-label">{label}</span>
            <span className="settings-row-desc">{desc}</span>
          </span>
          {setting && <button type="button" className="guide-row-link" onClick={() => onSetting(setting)}>Open in Settings</button>}
        </div>
      ))}
    </div>
  );
}

function Keys({ onSetting }) {
  const seek = useAppStore((s) => s.seekStep);
  const keys = [
    [[['Space']], 'Play or pause'],
    [[['←'], ['→']], `Jump back or forward ${seek} ${seek === 1 ? 'second' : 'seconds'}`, 'seekStep'],
    [[['Shift', '←']], 'Previous song'],
    [[['Shift', '→']], 'Next song'],
    [[['↑'], ['↓']], 'Volume up or down'],
  ];
  return (
    <section className="settings-group">
      <h4 className="settings-group-title">Keys</h4>
      <p className="settings-group-note">They work anywhere in the player, unless you're typing.</p>
      <div className="settings-rows">
        {keys.map(([groups, does, setting]) => (
          <div key={does} className="settings-row guide-row">
            <span className="guide-keys">
              {groups.map((combo) => (
                <span key={combo.join('+')} className="guide-combo">
                  {combo.map((key, i) => (
                    <Fragment key={key}>
                      {i > 0 && <span className="guide-kbd-plus">+</span>}
                      <kbd className="guide-kbd">{key}</kbd>
                    </Fragment>
                  ))}
                </span>
              ))}
            </span>
            <span className="settings-row-info"><span className="settings-row-label">{does}</span></span>
            {setting && <button type="button" className="guide-row-link" onClick={() => onSetting(setting)}>Open in Settings</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

// three steps that show a side for the first time, each a moving picture of the real thing and a line about it.
export function Welcome({ area, onDone }) {
  const { steps, done } = WELCOME[area];
  const [step, setStep] = useState(0);
  const last = step === steps.length - 1;
  const { title, text, Scene } = steps[step];

  const finish = () => {
    localStorage.setItem(WELCOMED[area], 'true');
    onDone();
  };

  // escape skips the rest.
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape') return;
      localStorage.setItem(WELCOMED[area], 'true');
      onDone();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [area, onDone]);

  return (
    <div className="guide-backdrop">
      <div className="welcome" role="dialog" aria-label={`Welcome to the ${NAMES[area].toLowerCase()}`}>
        <div className="welcome-stage"><Scene key={step} /></div>
        <div className="welcome-body">
          <h2 className="welcome-title">{title}</h2>
          <p className="welcome-text">{last ? `${text} ${GUIDE_HINT}` : text}</p>
          <div className="welcome-foot">
            <span className="welcome-dots" aria-label={`${step + 1} of ${steps.length}`}>
              {steps.map((s, i) => <i key={s.title} className={i === step ? 'welcome-dot-on' : undefined} />)}
            </span>
            {!last && <button type="button" className="welcome-skip" onClick={finish}>Skip</button>}
            {step > 0 && <button type="button" className="welcome-btn" onClick={() => setStep(step - 1)}>Back</button>}
            <button key={step} type="button" className="welcome-btn welcome-btn-main" onClick={last ? finish : () => setStep(step + 1)} autoFocus>
              {last ? done : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// the topic each side showed last, so coming back to a side returns there.
const lastTopic = { download: 'find', player: 'folders' };

// one window of help for both sides, with the side you're in first.
// the other side only shows once it's been agreed to, since it can't be visited before then.
export default function Guide({ view, onClose }) {
  const other = view === 'download' ? 'player' : 'download';
  const sides = agreed(other) ? [view, other] : [view];
  const [side, setSide] = useState(view);
  const [topicId, setTopicId] = useState(lastTopic[view]);
  const [welcome, setWelcome] = useState(null);
  const bodyRef = useRef(null);
  const topics = TOPICS[side];
  const topic = topics.find((t) => t.id === topicId) || topics[0];
  const { Scene } = topic;

  useEffect(() => {
    lastTopic[side] = topic.id;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [side, topic.id]);

  // escape closes the guide, unless the welcome is playing over it.
  useEffect(() => {
    if (welcome) return undefined;
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [welcome, onClose]);

  // a row's setting opens in the settings window, on its own side, lit up.
  const openSetting = (id) => {
    const found = entry(id);
    if (!found) return;
    onClose();
    useAppStore.getState().openSettings(pageOf(found.page).side === 'player' ? 'player' : 'home', id);
  };

  if (welcome) return <Welcome area={welcome} onDone={() => setWelcome(null)} />;

  return (
    <div className="guide-backdrop" onClick={onClose}>
      <div className="settings-modal guide-window" role="dialog" aria-label="Guide" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Guide</h2>
          {sides.length > 1 && (
            <div className="settings-sides">
              {sides.map((s) => (
                <button key={s} type="button" className={`settings-side${s === side ? ' settings-side-active' : ''}`} aria-pressed={s === side} onClick={() => { setSide(s); setTopicId(lastTopic[s]); }}>
                  {NAMES[s]}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="settings-close" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-main">
          <nav className="settings-nav">
            {topics.map((t) => (
              <button key={t.id} type="button" className={`settings-nav-btn${t.id === topic.id ? ' settings-nav-btn-active' : ''}`} aria-current={t.id === topic.id ? 'page' : undefined} onClick={() => setTopicId(t.id)}>
                <Icon name={t.icon} />
                {t.name}
              </button>
            ))}
            <button type="button" className="guide-replay" onClick={() => setWelcome(side)}>
              <Icon name="replay" size={13} />
              Replay the welcome
            </button>
          </nav>

          <div className="settings-body" ref={bodyRef}>
            <div className="settings-page-head">
              <h3 className="settings-page-title">{topic.name}</h3>
            </div>
            {Scene && <Scene key={`${side}:${topic.id}`} {...topic.sceneProps} />}
            {topic.keys && <Keys onSetting={openSetting} />}
            {topic.keys ? (
              <section className="settings-group">
                <h4 className="settings-group-title">Shuffle and repeat</h4>
                <Rows rows={topic.rows} onSetting={openSetting} />
              </section>
            ) : (
              <Rows rows={topic.rows} onSetting={openSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
