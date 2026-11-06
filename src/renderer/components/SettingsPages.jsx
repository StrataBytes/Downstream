import { useEffect, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { NotchedSlider, RangeSlider } from './Sliders';
import { countMeasured, clearLoudnessCache } from '../services/loudnessService';
import { entry } from '../utils/settingsCatalog';
import { Group, Rows, Row, SwitchRow, SliderRow, Cards, Pills, LiteHeld, ModeOptions } from './SettingsParts';
import {
  usePointerLoop, ModeDrawing, ProfileDrawing, BackgroundPreview, VisualizerPreview, StyleDrawing, LoudnessPreview, TouchBarPreview, TOUCH_BAR_PLACES,
} from './SettingsPreviews';
import { YtDlp, Graphics } from './AdvancedOptions';

const set = (key) => (value) => useAppStore.getState().setSetting(key, value);
const signed = (v, unit) => (v ? `${v > 0 ? '+' : ''}${v} ${unit}` : 'Original');
const original = (id) => entry(id).original;

// ===== the app side =====

// --- general ---

function InterfaceSize() {
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    window.electronAPI.getInterfaceSize().then(setInfo);
  }, []);
  if (!info) return null;
  const options = info.sizes.map((size) => ({ id: String(size), name: `${Math.round(size * 100)}%`, disabled: !info.fitting.includes(size) }));
  const tooBig = options.filter((o) => o.disabled);
  const choose = async (id) => {
    const res = await window.electronAPI.setInterfaceSize(Number(id));
    setProblem(res.error || null);
    if (!res.error) setInfo({ ...info, size: res.size });
  };
  const note = `Adjust the interface for different screen sizes.${tooBig.length ? ` ${tooBig.map((o) => o.name).join(' and ')} ${tooBig.length === 1 ? "doesn't" : "don't"} fit on this screen.` : ''}`;
  return (
    <SliderRow id="interfaceSize" label="Interface size" note={problem || note}>
      <NotchedSlider label="Interface size" options={options} value={String(info.size)} onChange={choose} />
    </SliderRow>
  );
}

export function GeneralPage() {
  const s = useAppStore();
  return (
    <Rows>
      <InterfaceSize />
      <SwitchRow id="checkUpdatesOnStart" label="Check for updates on start" desc="Shows a banner when a newer Downstream is out." on={s.checkUpdatesOnStart} onChange={s.setCheckUpdatesOnStart} />
    </Rows>
  );
}

// --- downloads ---

export function DownloadsPage() {
  const s = useAppStore();
  return (
    <>
      <Rows>
        <SwitchRow id="askWhereToSave" label="Ask where to save downloads" desc="Turned off, everything goes to the Downloads folder." on={s.askWhereToSave} onChange={s.setAskWhereToSave} />
        <SwitchRow id="fastDownloadPacing" label="Shorter pauses between downloads" desc="1 second apart instead of 3, with no longer break after every 5. YouTube is more likely to slow down or block them." on={s.fastDownloadPacing} onChange={s.setFastDownloadPacing} />
      </Rows>
      <Group title="Downloader">
        <Rows><YtDlp /></Rows>
      </Group>
    </>
  );
}

// --- library ---

const FORMATS = [
  { key: 'acceptMp3', name: 'MP3' },
  { key: 'acceptFlac', name: 'FLAC' },
  { key: 'acceptWav', name: 'WAV' },
  { key: 'acceptMp4', name: 'MP4' },
];

export function LibraryPage() {
  const s = useAppStore();
  return (
    <>
      <Group title="Formats it plays" note="Changes apply the next time a folder opens. MP4s also play their video behind the player.">
        <div className="settings-chips">
          {FORMATS.map(({ key, name }) => (
            <button key={key} type="button" role="switch" aria-checked={s[key]} className="settings-chip" data-setting={key} onClick={() => s[`set${key[0].toUpperCase()}${key.slice(1)}`](!s[key])}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              {name}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Scanning">
        <Rows>
          <SwitchRow id="behaviorWatchFolder" label="Watch folders for changes" desc="Added and removed songs are picked up without stopping what's playing." on={s.behaviorWatchFolder} onChange={s.setBehaviorWatchFolder} />
        </Rows>
      </Group>
    </>
  );
}

// --- performance ---

const PROFILES = [
  { id: 'standard', name: 'Standard', description: 'Everything, with blur and motion', drawing: <ProfileDrawing profile="standard" /> },
  { id: 'lite', name: 'Lite Mode', description: 'Lighter, for older computers', drawing: <ProfileDrawing profile="lite" /> },
];

export function PerformancePage() {
  const s = useAppStore();
  return (
    <>
      <Group id="renderProfile">
        <Cards options={PROFILES} value={s.renderProfile} onChange={s.setRenderProfile} />
        {s.renderProfile === 'lite' && (
          <ModeOptions title="Lite Mode turns off">
            <Rows>
              <SwitchRow id="liteDisableBlur" label="Blur" desc="The biggest saving on older graphics." on={s.liteDisableBlur} onChange={s.setLiteDisableBlur} />
              <SwitchRow id="liteDisableAnimations" label="Animations" desc="Spinners and progress keep moving." on={s.liteDisableAnimations} onChange={s.setLiteDisableAnimations} />
              <SwitchRow id="liteDisableVisualizer" label="Visualizer" on={s.liteDisableVisualizer} onChange={s.setLiteDisableVisualizer} />
              <SwitchRow id="liteDisableVideoBackground" label="Video backgrounds" on={s.liteDisableVideoBackground} onChange={s.setLiteDisableVideoBackground} />
            </Rows>
          </ModeOptions>
        )}
      </Group>
      <Graphics />
    </>
  );
}

// --- touch bar ---

// each switch shows the touch bar where its button lives.
const TOUCH_BAR_GROUPS = [
  { title: 'In the player', place: 'player', items: [['trackTitle', 'Track title'], ['volume', 'Volume control'], ['shuffleRepeat', 'Shuffle and repeat']] },
  { title: 'In the downloader', place: 'download', items: [['formatSwitch', 'Format switch'], ['downloadStatus', 'Download progress']] },
  { title: 'Everywhere', place: null, items: [['musicEverywhere', 'Media controls outside the player'], ['controlStrip', 'Player in the Control Strip']] },
];

export function TouchBarPage() {
  const prefs = useAppStore((s) => s.touchBarPrefs);
  const setPref = useAppStore((s) => s.setTouchBarPref);
  const [place, setPlace] = useState('player');
  const toggle = (group, key, on) => {
    setPref(key, on);
    if (group.place) setPlace(group.place);
    else if (key === 'musicEverywhere' && place === 'player') setPlace('home');
  };
  return (
    <>
      <div className="settings-stage sp-tb-stage">
        <Pills options={TOUCH_BAR_PLACES} value={place} onChange={setPlace} />
        <TouchBarPreview place={place} />
      </div>
      {TOUCH_BAR_GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          <Rows>
            {group.items.map(([key, label]) => (
              <SwitchRow key={key} id={`touchBarPrefs.${key}`} label={label} on={prefs[key]} onChange={(on) => toggle(group, key, on)} />
            ))}
          </Rows>
        </Group>
      ))}
      <p className="settings-page-note">While a text field is focused, macOS shows typing suggestions instead.</p>
    </>
  );
}

// ===== the player side =====

// --- view ---

const VIEW_MODES = [
  { id: 'explorer', name: 'Explorer', description: 'Everything in view' },
  { id: 'commander', name: 'Commander', description: 'Controls on hover' },
  { id: 'immersive', name: 'Voyager', description: 'Stars, and a player that fades' },
];

const FADE_AFTER = [
  { id: '3', name: '3s' },
  { id: '5', name: '5s' },
  { id: '10', name: '10s' },
  { id: '15', name: '15s' },
  { id: 'never', name: 'Never' },
];

export function ViewPage() {
  const s = useAppStore();
  const { idle, pass } = usePointerLoop();
  const voyager = s.playerViewMode === 'immersive';
  const stillTitles = s.renderProfile === 'lite' && s.liteDisableAnimations;
  const modes = VIEW_MODES.map((mode) => ({ ...mode, drawing: <ModeDrawing mode={mode.id} idle={idle} pass={pass} /> }));
  return (
    <>
      <Group id="playerViewMode">
        <Cards options={modes} value={s.playerViewMode} onChange={s.setPlayerViewMode} />
        {voyager && (
          <ModeOptions>
            <Rows>
              <SliderRow id="voyagerStarDensity" label="Star density" value={`${Math.round(s.voyagerStarDensity * 100)}%`}>
                <RangeSlider label="Star density" min={0.5} max={1.5} step={0.05} original={original('voyagerStarDensity')} ends={['Sparse', 'Dense']} value={s.voyagerStarDensity} onChange={set('voyagerStarDensity')} />
              </SliderRow>
            </Rows>
          </ModeOptions>
        )}
      </Group>
      <Group title="On screen">
        <Rows>
          <SwitchRow id="behaviorHideProgressBar" label="Progress bar" on={!s.behaviorHideProgressBar} onChange={(on) => s.setBehaviorHideProgressBar(!on)} />
          {!stillTitles && (
            <SwitchRow id="behaviorDisableSlidingTitles" label="Sliding titles" desc="Long song names scroll so they can be read." on={!s.behaviorDisableSlidingTitles} onChange={(on) => s.setBehaviorDisableSlidingTitles(!on)} />
          )}
        </Rows>
        {stillTitles && <LiteHeld id="behaviorDisableSlidingTitles" lite="liteDisableAnimations">Lite Mode keeps long song names still.</LiteHeld>}
      </Group>
      <Group title="Fading">
        <Rows>
          <SliderRow
            id="voyagerFadeAfter"
            label="Fade away after"
            note={voyager
              ? 'The player and the back arrow fade once nothing is touched while media plays.'
              : 'The back arrow fades once nothing is touched while media plays. In Voyager, the player fades too.'}
          >
            <NotchedSlider label="Fade away after" options={FADE_AFTER} value={s.voyagerFadeAfter} onChange={set('voyagerFadeAfter')} />
          </SliderRow>
        </Rows>
      </Group>
    </>
  );
}

// --- background ---

const BLUR_QUALITIES = [
  { id: 'off', name: 'Off', description: 'Sharp art, darkened. The lightest on graphics.' },
  { id: 'low', name: 'Low', description: 'Softened once per song, so it costs almost nothing. Videos still blur live.' },
  { id: 'medium', name: 'Medium', description: 'Like Low, keeping more of the art\'s shape.' },
  { id: 'high', name: 'High', description: 'Worked out live. The richest look, and the heaviest on older graphics.' },
];

export function BackgroundPage() {
  const s = useAppStore();
  const lite = s.renderProfile === 'lite';
  // what lite mode is holding off has no say while it does, so it isn't shown.
  const blur = !(lite && s.liteDisableBlur);
  const video = !(lite && s.liteDisableVideoBackground);
  const quality = BLUR_QUALITIES.find((q) => q.id === s.lookBlurQuality) || BLUR_QUALITIES[3];
  return (
    <>
      <BackgroundPreview />
      <Group>
        <Rows>
          <SwitchRow id="behaviorAlbumBackground" label="Album art background" desc="The playing song's cover, or its video." on={s.behaviorAlbumBackground} onChange={s.setBehaviorAlbumBackground} />
          {s.behaviorAlbumBackground && (
            <>
              {blur && (
                <SliderRow id="lookBlurQuality" label="Blur quality" note={quality.description}>
                  <NotchedSlider label="Blur quality" options={BLUR_QUALITIES} value={s.lookBlurQuality} onChange={set('lookBlurQuality')} />
                </SliderRow>
              )}
              {blur && s.lookBlurQuality !== 'off' && (
                <SliderRow id="lookBlurIntensity" label="Blur intensity" value={`${s.lookBlurIntensity} px`}>
                  <RangeSlider label="Blur intensity" min={10} max={50} step={1} original={original('lookBlurIntensity')} ends={['Light', 'Heavy']} value={s.lookBlurIntensity} onChange={set('lookBlurIntensity')} />
                </SliderRow>
              )}
              <SliderRow id="lookBackgroundDim" label="Dimness" value={`${s.lookBackgroundDim}%`}>
                <RangeSlider label="Background dimness" min={0} max={100} step={1} original={original('lookBackgroundDim')} ends={['Brighter', 'Darker']} value={s.lookBackgroundDim} onChange={set('lookBackgroundDim')} />
              </SliderRow>
              {video && (
                <SwitchRow id="behaviorHoldVideoFrame" label="Hold the video frame on pause" desc="A paused video stays behind the player instead of fading away." on={s.behaviorHoldVideoFrame} onChange={s.setBehaviorHoldVideoFrame} />
              )}
            </>
          )}
        </Rows>
        {s.behaviorAlbumBackground && !blur && <LiteHeld id="lookBlurQuality" lite="liteDisableBlur">Lite Mode keeps the blur off.</LiteHeld>}
      </Group>
      {blur && (
        <Group title="Panels">
          <Rows>
            <SliderRow id="lookPanelOpacity" label="Transparency" value={`${Math.round((1 - s.lookPanelOpacity) * 100)}%`}>
              <RangeSlider label="Panel transparency" min={0} max={0.36} step={0.01} original={Number((1 - original('lookPanelOpacity')).toFixed(2))} ends={['Solid', 'Glassy']} value={Number((1 - s.lookPanelOpacity).toFixed(2))} onChange={(v) => set('lookPanelOpacity')(Number((1 - v).toFixed(2)))} />
            </SliderRow>
          </Rows>
        </Group>
      )}
    </>
  );
}

// --- visualizer ---

const VISUALIZER_STYLES = [
  { id: 'modern', name: 'Modern', description: 'Smooth and clear across the whole song', drawing: <StyleDrawing style="modern" /> },
  { id: 'legacy', name: 'Legacy', description: 'The original, exactly as it used to look', drawing: <StyleDrawing style="legacy" /> },
];

const VISUALIZER_DETAIL = [
  { id: 'standard', name: 'Standard', description: '80 bars, the original look.' },
  { id: 'high', name: 'High', description: '120 bars. Uses a bit more performance.' },
  { id: 'ultra', name: 'Ultra', description: '160 bars, best with the window wide. Uses the most performance.' },
];

export function VisualizerPage() {
  const s = useAppStore();
  const liteOff = s.renderProfile === 'lite' && s.liteDisableVisualizer;
  const shown = !s.behaviorHideVisualizer && !liteOff;
  const style = VISUALIZER_STYLES.find((v) => v.id === s.visualizerStyle) || VISUALIZER_STYLES[0];
  const detail = VISUALIZER_DETAIL.find((d) => d.id === s.visualizerDetail) || VISUALIZER_DETAIL[0];
  return (
    <>
      <VisualizerPreview />
      {liteOff ? (
        <LiteHeld id="behaviorHideVisualizer" lite="liteDisableVisualizer">Lite Mode turns the visualizer off.</LiteHeld>
      ) : (
        <Rows>
          <SwitchRow id="behaviorHideVisualizer" label="Show the visualizer" on={!s.behaviorHideVisualizer} onChange={(on) => s.setBehaviorHideVisualizer(!on)} />
        </Rows>
      )}
      {shown && (
        <Group title="Look">
          <Rows>
            <SliderRow id="visualizerStyle" label="Style">
              <Cards options={VISUALIZER_STYLES} value={style.id} onChange={s.setVisualizerStyle} />
            </SliderRow>
            <SliderRow id="visualizerDetail" label="Detail" note={detail.description}>
              <NotchedSlider label="Visualizer detail" options={VISUALIZER_DETAIL} value={s.visualizerDetail} onChange={s.setVisualizerDetail} />
            </SliderRow>
            <SliderRow id="lookVisualizerLift" label="Height" value={signed(s.lookVisualizerLift, 'dB')} note="As if the media were louder or quieter. What you hear stays the same.">
              <RangeSlider label="Visualizer height" min={-12} max={12} step={1} original={original('lookVisualizerLift')} ends={['Shorter', 'Taller']} value={s.lookVisualizerLift} onChange={set('lookVisualizerLift')} />
            </SliderRow>
            <SliderRow id="lookVisualizerBrightness" label="Brightness" value={`${Math.round(s.lookVisualizerBrightness * 100)}%`}>
              <RangeSlider label="Visualizer brightness" min={0.4} max={1.6} step={0.05} original={original('lookVisualizerBrightness')} ends={['Faint', 'Bold']} value={s.lookVisualizerBrightness} onChange={set('lookVisualizerBrightness')} />
            </SliderRow>
          </Rows>
        </Group>
      )}
    </>
  );
}

// --- sound ---

// contextual comes first as the original, and reactive is the older way it was done, kept as the legacy choice.
// the cards are plain, since the picture at the top of the page redraws for whichever is picked.
const NORMALIZER_MODES = [
  { id: 'contextual', name: 'Contextual', description: 'Measures each song once and plays it at one steady level, like Spotify and YouTube' },
  { id: 'reactive', name: 'Reactive', tag: 'Legacy', description: 'The original. Follows each song as it plays and adjusts the volume' },
];

const REACTIVE_PRESETS = [
  { id: 'normal', name: 'Normal', description: 'Gentle, steady correction within 6 dB either way. The recommended choice.' },
  { id: 'aggressive', name: 'Aggressive', description: 'Reacts within seconds to loud or quiet sections, and overcorrects more often.' },
  { id: 'rigorous', name: 'Rigorous', description: 'The fastest reaction and the widest range, from 10 dB down to 8 dB up. Overcorrects the most.' },
];

// how far measuring has got in the folder playing, and the measurements kept from before.
function ContextualMemory() {
  const files = useAppStore((s) => s.musicFiles);
  const scanning = useAppStore((s) => s.loudnessScanningTrack);
  const downloading = useAppStore((s) => s.isDownloading);
  useAppStore((s) => s.loudnessScanTick);
  const [confirming, setConfirming] = useState(false);
  const measured = countMeasured(files);
  const status = !files.length
    ? 'Songs are measured in the background once a folder is playing.'
    : measured === files.length
      ? 'Every song here is measured.'
      : scanning
        ? `Measuring "${scanning}". Until a song is measured, Reactive levels it.`
        : downloading
          ? 'Measuring waits until downloads finish.'
          : 'Until a song is measured, Reactive levels it.';
  return (
    <ModeOptions id="loudnessMemory">
      <Rows>
        <Row label="Measured in this folder" desc={status}>
          {files.length > 0 && (
            <span className="norm-measured">
              <span className="norm-measured-count">{measured} of {files.length}</span>
              <span className="norm-measured-bar"><i style={{ width: `${(measured / files.length) * 100}%` }} /></span>
            </span>
          )}
        </Row>
        <Row
          label="Saved measurements"
          desc={confirming ? 'Every song in every folder will be measured again.' : "Kept for each song until its file changes. Your files themselves are never changed."}
        >
          {confirming ? (
            <>
              <button className="advanced-action-button advanced-action-button-muted" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="advanced-action-button advanced-action-button-danger" onClick={() => { clearLoudnessCache(); setConfirming(false); }}>Delete</button>
            </>
          ) : (
            <button className="advanced-action-button advanced-action-button-muted" onClick={() => setConfirming(true)}>Delete</button>
          )}
        </Row>
      </Rows>
    </ModeOptions>
  );
}

export function SoundPage() {
  const s = useAppStore();
  const mode = NORMALIZER_MODES.find((m) => m.id === s.normalizerMode) || NORMALIZER_MODES[0];
  const preset = REACTIVE_PRESETS.find((p) => p.id === s.normalizerReactivePreset) || REACTIVE_PRESETS[0];
  return (
    <>
      <LoudnessPreview />
      <Rows>
        <SwitchRow id="musicNormalize" label="Normalize volume" desc="Plays every song at about the same loudness." on={s.musicNormalize} onChange={s.setMusicNormalize} />
      </Rows>
      {s.musicNormalize && (
        <Group id="normalizerMode" title="How it levels songs">
          <Cards options={NORMALIZER_MODES} value={mode.id} onChange={s.setNormalizerMode} />
          {mode.id === 'contextual' ? (
            <ContextualMemory />
          ) : (
            <ModeOptions>
              <Rows>
                <SliderRow id="normalizerReactivePreset" label="Aggressiveness" note={preset.description}>
                  <NotchedSlider label="Aggressiveness" options={REACTIVE_PRESETS} value={s.normalizerReactivePreset} onChange={s.setNormalizerReactivePreset} />
                </SliderRow>
              </Rows>
              <p className="settings-group-note">Contextual plays about 6 dB louder, at the level Spotify and YouTube use.</p>
            </ModeOptions>
          )}
        </Group>
      )}
    </>
  );
}

// --- playback ---

const SEEK_STEPS = [
  { id: '5', name: '5s' },
  { id: '10', name: '10s' },
  { id: '15', name: '15s' },
  { id: '30', name: '30s' },
];

const ADVANCE_DELAYS = [
  { id: '0', name: 'None' },
  { id: '1', name: '1s' },
  { id: '2', name: '2s' },
  { id: '3', name: '3s' },
  { id: '4', name: '4s' },
  { id: '5', name: '5s' },
];

export function PlaybackPage() {
  const s = useAppStore();
  return (
    <>
      <Group title="Starting a folder">
        <Rows>
          <SwitchRow id="behaviorShuffleOnStart" label="Shuffle when a folder opens" on={s.behaviorShuffleOnStart} onChange={s.setBehaviorShuffleOnStart} />
          <SwitchRow id="behaviorRememberShuffle" label="Remember shuffle between launches" desc="Songs that already played don't come back right away after a restart." on={s.behaviorRememberShuffle} onChange={s.setBehaviorRememberShuffle} />
        </Rows>
      </Group>
      <Group title="Between songs">
        <Rows>
          <SliderRow id="advanceDelay" label="Pause before the next song" note="When a song finishes and the next one comes up on its own. Skipping starts the next song straight away.">
            <NotchedSlider label="Pause before the next song" options={ADVANCE_DELAYS} value={String(s.advanceDelay)} onChange={(id) => set('advanceDelay')(Number(id))} />
          </SliderRow>
          <SwitchRow id="fadeInSongs" label="Fade in new songs" desc="Each song starts softly, whether it comes up on its own or you skip to it." on={s.fadeInSongs} onChange={set('fadeInSongs')} />
        </Rows>
      </Group>
      <Group title="Play and pause">
        <Rows>
          <SwitchRow id="fadePlayPause" label="Fade on play and pause" desc="Pausing eases the sound out and playing eases it back in, instead of cutting it off." on={s.fadePlayPause} onChange={set('fadePlayPause')} />
        </Rows>
      </Group>
      <Group title="Keyboard">
        <Rows>
          <SliderRow id="seekStep" label="Arrow key seek step" note="How far the left and right arrow keys jump. Hold Shift to skip songs instead.">
            <NotchedSlider label="Arrow key seek step" options={SEEK_STEPS} value={String(s.seekStep)} onChange={(id) => set('seekStep')(Number(id))} />
          </SliderRow>
        </Rows>
      </Group>
    </>
  );
}
