// builds the media:// url for a local file path.
// macos and linux register the 'media' scheme as "standard" (see main.js) so web audio doesn't treat it as cors-cross-origin, but standard schemes require a real authority component, so they use a stable host: media://local/<path>.
// windows' registration and url format were never broken, so they're left exactly as they always were: media:///<path> (empty host).
export function toMediaUrl(filePath) {
  const encoded = encodeURIComponent(filePath);
  return window.electronAPI?.platform !== 'win32'
    ? `media://local/${encoded}`
    : `media:///${encoded}`;
}
