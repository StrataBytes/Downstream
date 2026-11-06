// the download qualities, best first.
// the ids are what main's getFormatString reads.
export const QUALITIES = [
  { id: 'highest', label: 'Highest' },
  { id: 'uhd', label: '4K' },
  { id: 'qhd', label: '2K' },
  { id: 'high', label: '1080p' },
  { id: 'medium', label: '720p' },
  { id: 'low', label: '480p' },
];

export const FORMATS = [
  { id: 'mp4', label: 'MP4' },
  { id: 'mp3', label: 'MP3' },
];

export function qualityLabel(id) {
  return QUALITIES.find((q) => q.id === id)?.label || id;
}
