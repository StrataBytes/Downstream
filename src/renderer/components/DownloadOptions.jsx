import useAppStore from '../stores/useAppStore';
import { QUALITIES, FORMATS } from '../utils/qualities';

export default function DownloadOptions({ className }) {
  const quality = useAppStore((s) => s.downloadQuality);
  const setQuality = useAppStore((s) => s.setDownloadQuality);
  const format = useAppStore((s) => s.downloadFormat);
  const setFormat = useAppStore((s) => s.setDownloadFormat);

  return (
    <div className={className}>
      <select value={quality} onChange={(e) => setQuality(e.target.value)} title="Quality">
        {QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
      </select>
      <select value={format} onChange={(e) => setFormat(e.target.value)} title="Format">
        {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
    </div>
  );
}
