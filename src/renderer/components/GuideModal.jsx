import { useState } from 'react';

const ICONS = {
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  download: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  folder: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  music: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  ),
  play: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  sliders: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z" />
    </svg>
  ),
  file: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
};

const DOWNLOAD_TOPICS = [
  {
    id: 'overview', label: 'Overview', icon: ICONS.info,
    content: {
      title: 'Welcome to Downstream',
      body: (
        <>
          <p>Downstream lets you download videos and audio from the internet and save them directly to your computer.</p>
          <p>You can search for content, paste a direct link, or even pull from entire playlists -- all from one place!</p>
          <p>Downloads are always saved to your local <strong>Downloads</strong> folder by default. You can change this per-session, but it will reset each time you reopen the app.</p>
          <div className="guide-callout">Everything happens on your device. No accounts, no cloud, no tracking.</div>
        </>
      ),
    },
  },
  {
    id: 'downloading', label: 'Downloading', icon: ICONS.download,
    content: {
      title: 'Downloading Basics',
      body: (
        <>
          <p>Type a <strong>search term</strong> into the input bar to find content, or paste a <strong>direct link</strong> to add it straight to your queue.</p>
          <p>Downstream also supports <strong>public playlists</strong> and <strong>radio mixes</strong> -- paste the link and you'll be prompted to select which items to add.</p>
          <p>Each item is added to the queue individually, so you can review and adjust before downloading.</p>
        </>
      ),
    },
  },
  {
    id: 'quality', label: 'Quality & Formats', icon: ICONS.star,
    content: {
      title: 'Quality & Formats',
      body: (
        <>
          <p>Before adding content to the queue, you can pick a <strong>video quality</strong> -- options range from 480p up to the highest available resolution.</p>
          <p>Choose your <strong>output format</strong>:</p>
          <ul>
            <li><strong>MP4</strong> -- keeps the full video with audio</li>
            <li><strong>MP3</strong> -- extracts just the audio</li>
          </ul>
          <p>Quality and format are set when items are added, but you can change the format for any item in the queue afterwards.</p>
        </>
      ),
    },
  },
  {
    id: 'queue', label: 'Managing Your Queue', icon: ICONS.list,
    content: {
      title: 'Managing Your Queue',
      body: (
        <>
          <p>The queue panel shows everything you've lined up. From here you can:</p>
          <ul>
            <li><strong>Switch formats</strong> on individual items, or apply MP4/MP3 to the entire queue at once</li>
            <li><strong>Remove items</strong> you no longer want before starting</li>
            <li><strong>Review history</strong> of completed downloads from the current session</li>
          </ul>
          <p>Hit <strong>Download All</strong> to begin -- items are processed one at a time with real-time progress tracking.</p>
        </>
      ),
    },
  },
  {
    id: 'output', label: 'Output & Storage', icon: ICONS.folder,
    content: {
      title: 'Output & Storage',
      body: (
        <>
          <p>By default, downloads go to your system's <strong>Downloads</strong> folder.</p>
          <p>You can pick a different folder from the queue panel, but this choice <strong>resets each session</strong> -- Downstream does not remember custom paths between launches.</p>
          <div className="guide-callout">Downloaded files are standard MP4 or MP3 files that work with any media player.</div>
        </>
      ),
    },
  },
  {
    id: 'privacy', label: 'Privacy', icon: ICONS.lock,
    content: {
      title: 'Privacy & Your Data',
      body: (
        <>
          <p>Downstream <strong>never collects, stores, or transmits</strong> any personal data.</p>
          <p>The only external connection is to the <strong>public GitHub repository</strong> -- solely to check for newer versions. No identifying information is sent.</p>
          <div className="guide-callout">Your downloads, settings, and playback history all stay on your computer.</div>
        </>
      ),
    },
  },
  {
    id: 'responsibility', label: 'Responsible Use', icon: ICONS.shield,
    content: {
      title: 'Responsible Use',
      body: (
        <>
          <p>Downstream is a tool! How you use it is your responsibility.</p>
          <p>Only download content you <strong>own, have permission to access, or is freely available</strong> under its creator's terms.</p>
          <p>Be mindful of the platforms you download from -- many have terms of service that restrict automated downloading. Please respect those boundaries.</p>
          <div className="guide-callout">The developer does not endorse or encourage any form of piracy or copyright infringement.</div>
        </>
      ),
    },
  },
];

const PLAYER_TOPICS = [
  {
    id: 'overview', label: 'Overview', icon: ICONS.music,
    content: {
      title: 'Your Music Player',
      body: (
        <>
          <p>Downstream includes a built-in music player for your <strong>local audio files</strong>.</p>
          <p>Point it at a folder on your computer, and it becomes your playlist. No imports, no syncing. Just pick a folder and press play!</p>
          <p>MP4 files are supported too! The player extracts their audio and uses the video as a <strong>blurred ambient background</strong>, keeping the focus on listening rather than watching.</p>
          <div className="guide-callout">Supports MP3, FLAC, WAV, and MP4 out of the box. Formats can be toggled in Behavior settings.</div>
        </>
      ),
    },
  },
  {
    id: 'folders', label: 'Library & Folders', icon: ICONS.folder,
    content: {
      title: 'Library & Folders',
      body: (
        <>
          <p>Your library is <strong>folder-based</strong> -- each folder you add becomes a switchable playlist.</p>
          <ul>
            <li><strong>Add folders</strong> from the folder select screen</li>
            <li><strong>Switch</strong> between saved folders at any time via the folder chip</li>
            <li><strong>Remove</strong> folders you no longer need with the X button</li>
          </ul>
          <div className="guide-callout">Saved folders persist between sessions, so your library is always ready.</div>
        </>
      ),
    },
  },
  {
    id: 'playback', label: 'Playback', icon: ICONS.play,
    content: {
      title: 'Playback Controls',
      body: (
        <>
          <p>The player gives you straightforward controls:</p>
          <ul>
            <li><strong>Play / Pause</strong> -- the center button</li>
            <li><strong>Previous / Next</strong> -- skip through your playlist</li>
            <li><strong>Shuffle</strong> -- randomizes the play order</li>
            <li><strong>Repeat</strong> -- loops the current track</li>
          </ul>
          <p>When shuffle is on, finishing the queue <strong>reshuffles automatically</strong> so you get a fresh order each cycle.</p>

          <p><strong>Keybinds</strong> -- work anywhere in the player, as long as you're not typing in a text field:</p>
          <div className="guide-keybinds">
            <div className="guide-keybind-row">
              <span className="guide-keybind-keys"><kbd className="guide-kbd">Space</kbd></span>
              <span className="guide-keybind-desc">Play / Pause</span>
            </div>
            <div className="guide-keybind-row">
              <span className="guide-keybind-keys"><kbd className="guide-kbd">&larr;</kbd> <span className="guide-kbd-plus">/</span> <kbd className="guide-kbd">&rarr;</kbd></span>
              <span className="guide-keybind-desc">Seek back / forward 5 seconds</span>
            </div>
            <div className="guide-keybind-row">
              <span className="guide-keybind-keys"><kbd className="guide-kbd">Shift</kbd><span className="guide-kbd-plus">+</span><kbd className="guide-kbd">&larr;</kbd></span>
              <span className="guide-keybind-desc">Previous track</span>
            </div>
            <div className="guide-keybind-row">
              <span className="guide-keybind-keys"><kbd className="guide-kbd">Shift</kbd><span className="guide-kbd-plus">+</span><kbd className="guide-kbd">&rarr;</kbd></span>
              <span className="guide-keybind-desc">Next track</span>
            </div>
            <div className="guide-keybind-row">
              <span className="guide-keybind-keys"><kbd className="guide-kbd">&uarr;</kbd> <span className="guide-kbd-plus">/</span> <kbd className="guide-kbd">&darr;</kbd></span>
              <span className="guide-keybind-desc">Volume up / down 5%</span>
            </div>
          </div>
        </>
      ),
    },
  },
  {
    id: 'audio', label: 'Audio Processing', icon: ICONS.sliders,
    content: {
      title: 'Audio Processing',
      body: (
        <>
          <p>Fine-tune your sound with two built-in tools:</p>
          <div className="guide-feature">
            <strong>10-Band Equalizer</strong>
            <span>Shape your sound from 31Hz to 16kHz. Choose from presets like Bass Boost, Treble, or Smooth -- or dial in your own.</span>
          </div>
          <div className="guide-feature">
            <strong>Volume Normalization</strong>
            <span>Evens out volume differences between tracks so nothing is unexpectedly loud or quiet.</span>
          </div>
          <p>Both can be toggled from the chips below the player, or set to enable automatically on startup via Behavior settings.</p>
        </>
      ),
    },
  },
  {
    id: 'display', label: 'Display & Behavior', icon: ICONS.settings,
    content: {
      title: 'Display & Behavior',
      body: (
        <>
          <p>The <strong>Behavior</strong> chip opens a settings panel where you can customize the player to your liking.</p>
          <div className="guide-feature">
            <strong>View Modes</strong>
            <span>Switch between Explorer (everything visible) and Commander (compact -- hover to reveal controls). More modes coming soon.</span>
          </div>
          <div className="guide-feature">
            <strong>Visual Options</strong>
            <span>Toggle the frequency visualizer, album art backgrounds, the progress bar, and scrolling track titles.</span>
          </div>
          <p>The visualizer and progress bar are always positioned independently -- they're unaffected by view mode changes.</p>
        </>
      ),
    },
  },
  {
    id: 'formats', label: 'File Formats', icon: ICONS.file,
    content: {
      title: 'Supported Formats',
      body: (
        <>
          <p>The player scans folders for audio files based on your <strong>format preferences</strong>:</p>
          <ul>
            <li><strong>MP3</strong> -- enabled by default</li>
            <li><strong>FLAC</strong> -- enabled by default</li>
            <li><strong>WAV</strong> -- enabled by default</li>
            <li><strong>MP4</strong> -- enabled by default</li>
          </ul>
          <div className="guide-callout">Downstream is an audio-first player. MP4 files play their audio track normally, and when album art backgrounds are enabled, the video is shown as a blurred ambient backdrop rather than a full video player.</div>
          <p>Toggle formats in <strong>Behavior &gt; Formats & File Scanning</strong>. Changes take effect the next time a folder is loaded.</p>
        </>
      ),
    },
  },
  {
    id: 'privacy', label: 'Privacy', icon: ICONS.lock,
    content: {
      title: 'Privacy & Your Data',
      body: (
        <>
          <p>The player is <strong>entirely local</strong>. Your music never leaves your computer.</p>
          <p>No playback data, listening history, or library contents are ever collected or transmitted.</p>
          <div className="guide-callout">Downstream has no accounts, no analytics, and no telemetry -- anywhere in the app.</div>
        </>
      ),
    },
  },
];

const TOPIC_SETS = {
  download: DOWNLOAD_TOPICS,
  player: PLAYER_TOPICS,
};

export default function GuideModal({ type, onDismiss }) {
  const topics = TOPIC_SETS[type] || DOWNLOAD_TOPICS;
  const [activeTopic, setActiveTopic] = useState(topics[0].id);
  const [moreOpen, setMoreOpen] = useState(false);
  const topic = topics.find((t) => t.id === activeTopic);
  const isOverview = activeTopic === topics[0].id;
  const overviewTopic = topics[0];
  const extraTopics = topics.slice(1);

  const storageKey = type === 'download' ? 'guideDownloadSeen' : 'guidePlayerSeen';

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    onDismiss();
  };

  return (
    <div className="guide-backdrop">
      <div className="guide-modal">
        <div className="guide-sidebar">
          <h2 className="guide-sidebar-title">Getting Started</h2>
          <nav className="guide-nav">
            <button
              className={`guide-nav-btn guide-nav-primary${activeTopic === overviewTopic.id ? ' guide-nav-active' : ''}`}
              onClick={() => setActiveTopic(overviewTopic.id)}
            >
              {overviewTopic.icon}
              <span>{overviewTopic.label}</span>
            </button>

            {extraTopics.length > 0 && (
              <button
                className={`guide-nav-more-toggle${moreOpen ? ' guide-nav-more-toggle-open' : ''}`}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <span>{moreOpen ? 'Hide extra topics' : 'Show more topics'}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}

            {moreOpen && extraTopics.map((t) => (
              <button
                key={t.id}
                className={`guide-nav-btn guide-nav-secondary${activeTopic === t.id ? ' guide-nav-active' : ''}`}
                onClick={() => setActiveTopic(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          {!isOverview && (
            <button className="guide-dismiss-btn" onClick={handleDismiss}>
              Got It
            </button>
          )}
        </div>
        <div className="guide-content">
          <h2 className="guide-content-title">{topic.content.title}</h2>
          <div className="guide-content-body">{topic.content.body}</div>
          {isOverview && (
            <button className="guide-dismiss-btn guide-dismiss-btn-content" onClick={handleDismiss}>
              Got It!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
