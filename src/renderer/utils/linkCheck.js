// client-side link validation for the downloader input.
// catches obvious garbage (malformed urls, incomplete youtube links, misspelled domains) before anything spawns a yt-dlp subprocess.
// this is the cheapest form of rate limiting there is: a rejected typo costs zero network requests.

const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'www.youtu.be',
]);

const YT_VIDEO_ID = /^[\w-]{11}$/;

// small levenshtein for typo sniffing on short domain labels.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

// returns { ok: true, url } with a normalized url string, or { ok: false, reason } with a user-facing message.
export function validateMediaLink(raw) {
  let input = raw.trim();
  if (/^www\./i.test(input)) input = 'https://' + input;
  if (!/^https?:\/\//i.test(input)) {
    return { ok: false, reason: 'Only http(s) links can be added.' };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "That link doesn't look like a valid URL." };
  }

  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) {
    return { ok: false, reason: "That link doesn't look like a valid URL." };
  }

  if (YT_HOSTS.has(host)) {
    if (host.endsWith('youtu.be')) {
      const id = url.pathname.slice(1).split('/')[0];
      if (!YT_VIDEO_ID.test(id)) {
        return { ok: false, reason: 'This YouTube share link looks incomplete -- no video ID after youtu.be/.' };
      }
      return { ok: true, url: url.toString() };
    }
    const p = url.pathname;
    const validPath =
      (p === '/watch' && (YT_VIDEO_ID.test(url.searchParams.get('v') || '') || url.searchParams.has('list'))) ||
      /^\/shorts\/[\w-]{11}/.test(p) ||
      /^\/live\/[\w-]{11}/.test(p) ||
      (p === '/playlist' && url.searchParams.has('list'));
    if (!validPath) {
      return { ok: false, reason: "This YouTube link doesn't point at a video or playlist." };
    }
    return { ok: true, url: url.toString() };
  }

  // typo sniffing: any hostname label within 2 edits of "youtube" (but not youtube itself, since real hosts were accepted above) is almost certainly a misspelling, e.g. yuotube.com, youtubee.com, yotube.com.
  for (const label of host.split('.')) {
    if (label !== 'youtube' && editDistance(label, 'youtube') <= 2) {
      return { ok: false, reason: `"${host}" looks like a misspelling of youtube.com.` };
    }
  }
  // yout.be / yutu.be style typos of the share domain.
  if (host.endsWith('.be')) {
    const label = host.replace(/\.be$/, '').replace(/^www\./, '');
    if (label !== 'youtu' && editDistance(label, 'youtu') <= 1) {
      return { ok: false, reason: `"${host}" looks like a misspelling of youtu.be.` };
    }
  }

  // anything else parses cleanly, let yt-dlp try it (it supports many sites).
  return { ok: true, url: url.toString() };
}

// canonicalizes a single-video youtube link to its minimal watch url, so the same video pasted different ways (youtu.be share links with ?si= tracking, &t= timestamps, shorts/live paths, music.youtube.com) dedupes to one queue entry.
// playlist links (with ?list=) and non-youtube urls pass through untouched, only call this on links already bound for a single-video add.
export function canonicalVideoUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    let id = null;
    if (host.endsWith('youtu.be')) {
      id = u.pathname.slice(1).split('/')[0];
    } else if (YT_HOSTS.has(host)) {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else {
        const m = u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
        if (m) id = m[1];
      }
    }
    return id && YT_VIDEO_ID.test(id)
      ? `https://www.youtube.com/watch?v=${id}`
      : urlStr;
  } catch {
    return urlStr;
  }
}
