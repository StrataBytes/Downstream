import useAppStore from '../stores/useAppStore';

export default function NormalizationInfoModal() {
  const normInfoOpen = useAppStore((s) => s.normInfoOpen);
  const setNormInfoOpen = useAppStore((s) => s.setNormInfoOpen);

  if (!normInfoOpen) return null;

  return (
    <div className="modal" onClick={() => setNormInfoOpen(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>How Contextual Normalization Works</h2>
        <div className="guide-content-body">
          <ul>
            <li>Each track is scanned once in the background, measuring its loudness the same way Spotify and YouTube do.</li>
            <li>That scan produces one fixed volume adjustment for the whole track, applied instantly on every play after. No guessing in real time.</li>
            <li>Until a track has been scanned, it plays through the quicker (but less precise) Reactive engine as a stand-in.</li>
            <li>Scanning only measures loudness. Your files themselves are never modified.</li>
          </ul>
        </div>
        <div className="modal-buttons">
          <button onClick={() => setNormInfoOpen(false)}>Got It</button>
        </div>
      </div>
    </div>
  );
}
