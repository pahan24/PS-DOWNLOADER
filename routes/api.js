'use strict';

const express    = require('express');
const router     = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const path       = require('path');
const fs         = require('fs');

const execFileAsync = promisify(execFile);
const TIMEOUT = 35000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';

// ── Resolve yt-dlp path ───────────────────────────────────────────────────────
function getYtdlpPath() {
  // 1. Check ./bin/ (downloaded by postinstall on Heroku)
  var local = path.join(__dirname, '..', 'bin', 'yt-dlp');
  if (fs.existsSync(local))         return local;
  if (fs.existsSync(local + '.exe')) return local + '.exe';
  // 2. System PATH fallback
  return 'yt-dlp';
}
const YTDLP = getYtdlpPath();
console.log('[api] yt-dlp path:', YTDLP);

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSize(b) {
  if (!b) return null;
  return b < 1048576
    ? Math.round(b / 1024) + ' KB'
    : (b / 1048576).toFixed(1) + ' MB';
}

function fmtDur(s) {
  if (!s) return null;
  var h   = Math.floor(s / 3600);
  var m   = Math.floor((s % 3600) / 60);
  var sec = Math.floor(s % 60);
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return m + ':' + String(sec).padStart(2,'0');
}

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url))  return { name: 'YouTube',   icon: '▶' };
  if (/tiktok\.com/i.test(url))             return { name: 'TikTok',    icon: '♪' };
  if (/instagram\.com/i.test(url))          return { name: 'Instagram', icon: '📸' };
  if (/facebook\.com|fb\.watch/i.test(url)) return { name: 'Facebook',  icon: '👥' };
  if (/twitter\.com|x\.com/i.test(url))     return { name: 'Twitter/X', icon: '𝕏' };
  if (/reddit\.com|v\.redd\.it/i.test(url)) return { name: 'Reddit',    icon: '🤖' };
  if (/vimeo\.com/i.test(url))              return { name: 'Vimeo',     icon: '🎬' };
  return { name: 'Web Media', icon: '🌐' };
}

function getYTId(url) {
  var m = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function friendlyError(msg) {
  if (!msg) return 'Could not fetch media info.';
  if (/private/i.test(msg))                   return 'This video is private.';
  if (/not available|unavailable/i.test(msg)) return 'Video unavailable in this region.';
  if (/age|sign in/i.test(msg))               return 'Age-restricted — cannot download.';
  if (/removed|deleted/i.test(msg))           return 'This video has been removed.';
  if (/Unsupported URL/i.test(msg))           return 'Unsupported URL. Try a direct video link.';
  if (/403/i.test(msg))                       return 'Access denied by platform (403).';
  if (/404/i.test(msg))                       return 'Video not found (404).';
  if (/timed?\s*out/i.test(msg))              return 'Request timed out. Try again.';
  if (/members.only/i.test(msg))              return 'Members-only content.';
  if (/No such file|not found/i.test(msg))    return 'Media engine not ready. Try again in a moment.';
  return 'Failed to fetch media. Check the URL and try again.';
}

// ── Format ladder ─────────────────────────────────────────────────────────────
var VIDEO_LADDER = [
  { h: 2160, label: '4K 2160p',  tag: '4K',  icon: '🎯' },
  { h: 1440, label: 'QHD 1440p', tag: 'QHD', icon: '🎬' },
  { h: 1080, label: '1080p',     tag: 'FHD', icon: '🎬' },
  { h: 720,  label: '720p',      tag: 'HD',  icon: '📹' },
  { h: 480,  label: '480p',      tag: 'SD',  icon: '📺' },
  { h: 360,  label: '360p',      tag: 'SD',  icon: '📺' },
  { h: 240,  label: '240p',      tag: 'LOW', icon: '📱' },
  { h: 144,  label: '144p',      tag: 'LOW', icon: '📱' },
];

function buildFormats(info, url) {
  var raw   = info.formats || [];
  var isYT  = /youtube\.com|youtu\.be/i.test(url);
  var isTT  = /tiktok\.com/i.test(url);
  var maxH  = 0;
  raw.forEach(function(f) { if (f.height && f.height > maxH) maxH = f.height; });

  var formats = [];

  // Video ladder
  VIDEO_LADDER.forEach(function(q) {
    var available = maxH >= q.h * 0.65;
    if (!available && !isYT) return; // non-YT: skip unavailable resolutions

    var match = raw
      .filter(function(f) { return f.vcodec && f.vcodec !== 'none' && f.height && f.height <= q.h; })
      .sort(function(a, b) { return (b.height || 0) - (a.height || 0); })[0];

    formats.push({
      id:        'mp4-' + q.h,
      label:     q.label + ' (.mp4)',
      type:      'video',
      ext:       'mp4',
      quality:   q.label,
      size:      match ? fmtSize(match.filesize || match.filesize_approx) : null,
      format_id: 'bestvideo[height<=' + q.h + '][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=' + q.h + ']+bestaudio/best[height<=' + q.h + ']',
      tag:       q.tag,
      icon:      q.icon,
      available: available
    });
  });

  // TikTok no-watermark
  if (isTT) {
    formats.unshift({
      id: 'nowm', label: 'No Watermark (.mp4)', type: 'video', ext: 'mp4',
      quality: 'Original', size: null,
      format_id: 'download_addr-0/bestvideo[ext=mp4]/best',
      tag: '✨', icon: '✨', available: true
    });
  }

  // Audio
  var audioRaw = raw
    .filter(function(f) { return f.vcodec === 'none' && f.acodec && f.acodec !== 'none'; })
    .sort(function(a, b) { return (b.abr || 0) - (a.abr || 0); });

  formats.push({
    id: 'mp3-320', label: 'MP3 320kbps (.mp3)', type: 'audio', ext: 'mp3',
    quality: '320kbps', size: audioRaw[0] ? fmtSize(audioRaw[0].filesize) : null,
    format_id: 'bestaudio/best', tag: 'MP3', icon: '🎵', available: true
  });
  formats.push({
    id: 'mp3-128', label: 'MP3 128kbps (.mp3)', type: 'audio', ext: 'mp3',
    quality: '128kbps', size: null,
    format_id: 'worstaudio[acodec!=none]/worst', tag: 'MP3', icon: '🎵', available: true
  });

  return formats;
}

// ── GET /api/status ───────────────────────────────────────────────────────────
router.get('/status', async function(_req, res) {
  var ytdlpOk = false, ytdlpVer = null;
  try {
    var r = await execFileAsync(YTDLP, ['--version'], { timeout: 8000 });
    ytdlpOk = true;
    ytdlpVer = r.stdout.trim();
  } catch (e) {
    console.log('[status] yt-dlp check failed:', e.message.slice(0, 100));
  }
  res.json({
    status: 'ok',
    version: '1.0.0',
    ytdlp: ytdlpOk,
    ytdlpVersion: ytdlpVer,
    ytdlpPath: YTDLP,
    platforms: ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'Twitter/X', 'Reddit', 'Vimeo', '1000+ more']
  });
});

// ── POST /api/info ────────────────────────────────────────────────────────────
router.post('/info', async function(req, res) {
  var url = req.body && req.body.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required.' });
  }
  url = url.trim();

  var parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https URLs are allowed.' });
  }

  var BLOCKED = ['netflix.com','spotify.com','disneyplus.com','hulu.com','primevideo.com','max.com'];
  if (BLOCKED.some(function(d) { return parsed.hostname.includes(d); })) {
    return res.status(400).json({ error: 'This platform uses DRM and cannot be downloaded.' });
  }

  try {
    console.log('[info]', url.slice(0, 80));
    var r = await execFileAsync(YTDLP, [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      '--geo-bypass',
      '--no-check-certificates',
      '--user-agent', UA,
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      url
    ], { timeout: TIMEOUT, maxBuffer: 12 * 1024 * 1024 });

    var info    = JSON.parse(r.stdout);
    var formats = buildFormats(info, url);
    var ytId    = getYTId(url);

    return res.json({
      success:  true,
      url:      url,
      platform: detectPlatform(url),
      media: {
        title:    info.title || 'Untitled',
        thumbnail: ytId
          ? 'https://i.ytimg.com/vi/' + ytId + '/maxresdefault.jpg'
          : (info.thumbnail || null),
        thumbnailFallback: ytId
          ? 'https://i.ytimg.com/vi/' + ytId + '/hqdefault.jpg'
          : null,
        duration:  fmtDur(info.duration),
        uploader:  info.uploader || info.channel || null,
        viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
        formats:   formats
      }
    });
  } catch (err) {
    console.error('[info error]', err.message ? err.message.slice(0, 200) : err);
    return res.status(422).json({ error: friendlyError(err.message) });
  }
});

// ── POST /api/download ────────────────────────────────────────────────────────
router.post('/download', async function(req, res) {
  var url      = req.body && req.body.url;
  var formatId = req.body && req.body.formatId;
  var type     = req.body && req.body.type;
  var ext      = req.body && req.body.ext;

  if (!url || !formatId) {
    return res.status(400).json({ error: 'url and formatId are required.' });
  }

  var fmtArg;
  if (formatId.startsWith('mp4-')) {
    var h = parseInt(formatId.replace('mp4-', ''));
    fmtArg = 'bestvideo[height<=' + h + '][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=' + h + ']+bestaudio/best[height<=' + h + ']';
  } else if (formatId === 'mp3-320') {
    fmtArg = 'bestaudio/best';
  } else if (formatId === 'mp3-128') {
    fmtArg = 'worstaudio[acodec!=none]/worst';
  } else if (formatId === 'nowm') {
    fmtArg = 'download_addr-0/bestvideo[ext=mp4]/best';
  } else {
    fmtArg = formatId;
  }

  try {
    console.log('[download]', formatId, url.slice(0, 60));
    var r = await execFileAsync(YTDLP, [
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '--geo-bypass',
      '--no-check-certificates',
      '-f', fmtArg,
      '--user-agent', UA,
      url.trim()
    ], { timeout: TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

    var directUrl = r.stdout.trim().split('\n')[0];
    if (!directUrl) {
      return res.status(500).json({ error: 'Could not get download URL.' });
    }
    return res.json({
      success: true,
      downloadUrl: directUrl,
      formatId: formatId,
      type: type || 'video',
      ext: ext || 'mp4'
    });
  } catch (err) {
    console.error('[download error]', err.message ? err.message.slice(0, 150) : err);
    return res.status(500).json({ error: friendlyError(err.message) });
  }
});

// ── GET /api/proxy-download ───────────────────────────────────────────────────
router.get('/proxy-download', async function(req, res) {
  var url      = req.query.url;
  var filename = req.query.filename;
  var ext      = req.query.ext;

  if (!url) return res.status(400).json({ error: 'url param required' });

  var decoded;
  try {
    decoded = decodeURIComponent(url);
    new URL(decoded);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    var fetch = (await import('node-fetch')).default;
    var ups = await fetch(decoded, {
      headers: {
        'User-Agent':      UA,
        'Accept':          '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Range':           req.headers.range || 'bytes=0-',
        'Referer':         'https://www.youtube.com/'
      },
      redirect: 'follow'
    });

    if (!ups.ok && ups.status !== 206) {
      return res.status(ups.status).json({ error: 'Upstream ' + ups.status });
    }

    var safe = ((filename || 'ps-download').replace(/[^\w\s.-]/g, '_')).slice(0, 100);
    var fext = (ext || 'mp4').replace(/[^\w]/g, '');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '.' + fext + '"');
    res.setHeader('Content-Type', ups.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    var cl = ups.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    if (ups.status === 206) res.status(206);
    ups.body.pipe(res);
  } catch (err) {
    console.error('[proxy]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Proxy failed.' });
  }
});

// ── GET /api/thumbnail-proxy ──────────────────────────────────────────────────
router.get('/thumbnail-proxy', async function(req, res) {
  var url = req.query.url;
  if (!url) return res.status(400).end();
  try {
    var fetch = (await import('node-fetch')).default;
    var r = await fetch(decodeURIComponent(url), { headers: { 'User-Agent': UA } });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch { res.status(500).end(); }
});

module.exports = router;
