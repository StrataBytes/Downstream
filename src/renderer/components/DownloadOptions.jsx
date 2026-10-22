import useAppStore from '../stores/useAppStore';

export default function DownloadOptions({ className }) {
  const quality = useAppStore((s) => s.downloadQuality);
  const setQuality = useAppStore((s) => s.setDownloadQuality);
  const format = useAppStore((s) => s.downloadFormat);
  const setFormat = useAppStore((s) => s.setDownloadFormat);

  return (
    <div className={className}>
      <select value={quality} onChange={(e) => setQuality(e.target.value)} title="Quality">
        <option value="highest">Highest</option>
        <option value="high">1080p</option>
        <option value="medium">720p</option>
        <option value="low">480p</option>
      </select>
      <select value={format} onChange={(e) => setFormat(e.target.value)} title="Format">
        <option value="mp4">MP4</option>
        <option value="mp3">MP3</option>
      </select>
    </div>
  );
}
