const express    = require('express');
const router     = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const path       = require('path');
const fs         = require('fs');

const execFileAsync = promisify(execFile);
const TIMEOUT = 35000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';

// ── Find yt-dlp binary ────────────────────────────────────────────────────────
function getYtdlp() {
  const local = path.join(__dirname, '..', 'bin', 'yt-dlp');
  if (fs.existsSync(local))        return local;
  if (fs.existsSync(local+'.exe')) return local+'.exe';
  return 'yt-dlp'; // system PATH (Heroku Python buildpack installs here)
}
const YTDLP = getYtdlp();

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtSize = b => {
  if (!b) return null;
  return b < 1048576 ? (b/1024).toFixed(0)+' KB' : (b/1048576).toFixed(1)+' MB';
};
const fmtDur = s => {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60);
  return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
};

// ── Platform detection ────────────────────────────────────────────────────────
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url))   return { name:'YouTube',   icon:'▶' };
  if (/tiktok\.com/i.test(url))              return { name:'TikTok',    icon:'♪' };
  if (/instagram\.com/i.test(url))           return { name:'Instagram', icon:'📸' };
  if (/facebook\.com|fb\.watch/i.test(url))  return { name:'Facebook',  icon:'👥' };
  if (/twitter\.com|x\.com/i.test(url))      return { name:'Twitter/X', icon:'𝕏' };
  if (/reddit\.com|v\.redd\.it/i.test(url))  return { name:'Reddit',    icon:'🤖' };
  if (/vimeo\.com/i.test(url))               return { name:'Vimeo',     icon:'🎬' };
  return { name:'Web Media', icon:'🌐' };
}

// ── YouTube video ID ──────────────────────────────────────────────────────────
function getYTId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── Build format list from yt-dlp info ───────────────────────────────────────
const VIDEO_LADDER = [
  { h:2160, label:'4K 2160p',   tag:'4K',  icon:'🎯' },
  { h:1440, label:'QHD 1440p',  tag:'QHD', icon:'🎬' },
  { h:1080, label:'1080p',      tag:'FHD', icon:'🎬' },
  { h:720,  label:'720p',       tag:'HD',  icon:'📹' },
  { h:480,  label:'480p',       tag:'SD',  icon:'📺' },
  { h:360,  label:'360p',       tag:'SD',  icon:'📺' },
  { h:240,  label:'240p',       tag:'LOW', icon:'📱' },
  { h:144,  label:'144p',       tag:'LOW', icon:'📱' },
];

function buildFormats(info, url) {
  const raw  = info.formats || [];
  const maxH = Math.max(0, ...raw.filter(f=>f.height).map(f=>f.height));
  const isYT = /youtube\.com|youtu\.be/i.test(url);
  const isTT = /tiktok\.com/i.test(url);
  const formats = [];

  // Video formats
  for (const q of VIDEO_LADDER) {
    const available = maxH >= q.h * 0.65;
    if (!available && !isYT) continue; // non-YT: skip missing resolutions

    const match = raw
      .filter(f => f.vcodec && f.vcodec!=='none' && f.height && f.height <= q.h)
      .sort((a,b) => (b.height||0)-(a.height||0))[0];

    formats.push({
      id:        `mp4-${q.h}`,
      label:     `${q.label} (.mp4)`,
      type:      'video',
      ext:       'mp4',
      quality:   q.label,
      size:      match ? fmtSize(match.filesize || match.filesize_approx) : null,
      format_id: `bestvideo[height<=${q.h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q.h}]+bestaudio/best[height<=${q.h}]`,
      tag:       q.tag,
      icon:      q.icon,
      available
    });
  }

  // TikTok no-watermark
  if (isTT) {
    formats.unshift({
      id:'nowm', label:'No Watermark (.mp4)', type:'video', ext:'mp4',
      quality:'Original', size:null,
      format_id:'download_addr-0/bestvideo[ext=mp4]/best',
      tag:'✨', icon:'✨', available:true
    });
  }

  // Audio
  const audioRaw = raw.filter(f=>f.vcodec==='none' && f.acodec && f.acodec!=='none')
                      .sort((a,b)=>(b.abr||0)-(a.abr||0));
  formats.push({
    id:'mp3-320', label:'MP3 320kbps (.mp3)', type:'audio', ext:'mp3',
    quality:'320kbps', size: audioRaw[0] ? fmtSize(audioRaw[0].filesize) : null,
    format_id:'bestaudio/best', tag:'MP3', icon:'🎵', available:true
  });
  formats.push({
    id:'mp3-128', label:'MP3 128kbps (.mp3)', type:'audio', ext:'mp3',
    quality:'128kbps', size:null,
    format_id:'worstaudio[acodec!=none]/worst', tag:'MP3', icon:'🎵', available:true
  });

  return formats;
}

// ── Friendly error messages ───────────────────────────────────────────────────
function friendlyError(msg) {
  if (!msg) return 'Could not fetch media info.';
  if (/private/i.test(msg))                    return 'This video is private.';
  if (/not available|unavailable/i.test(msg))  return 'This video is unavailable in this region.';
  if (/age|sign in/i.test(msg))                return 'Age-restricted content — cannot download.';
  if (/removed|deleted/i.test(msg))            return 'This video has been removed.';
  if (/Unsupported URL/i.test(msg))            return 'Unsupported URL. Try a direct video link.';
  if (/403/i.test(msg))                        return 'Access denied by platform (403).';
  if (/404/i.test(msg))                        return 'Video not found (404). Link may be broken.';
  if (/timed? ?out/i.test(msg))               return 'Request timed out. Please try again.';
  if (/members.only/i.test(msg))               return 'Members-only content — cannot download.';
  if (/No such file|yt-dlp/i.test(msg))        return 'Media engine starting up — try again in a moment.';
  return 'Failed to fetch media. Check the URL and try again.';
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  let ytdlpOk = false, ytdlpVer = null;
  try {
    const r = await execFileAsync(YTDLP, ['--version'], { timeout:6000 });
    ytdlpOk = true; ytdlpVer = r.stdout.trim();
  } catch {}
  res.json({ status:'ok', version:'1.0.0', ytdlp:ytdlpOk, ytdlpVersion:ytdlpVer,
    platforms:['YouTube','TikTok','Instagram','Facebook','Twitter/X','Reddit','Vimeo','1000+ more'] });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/info
// ─────────────────────────────────────────────────────────────────────────────
router.post('/info', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error:'URL is required.' });

  let parsed;
  try { parsed = new URL(url.trim()); } catch { return res.status(400).json({ error:'Invalid URL.' }); }
  if (!['http:','https:'].includes(parsed.protocol)) return res.status(400).json({ error:'Only http/https URLs allowed.' });

  // Block DRM platforms
  const BLOCKED = ['netflix.com','spotify.com','disneyplus.com','hulu.com','primevideo.com','max.com'];
  if (BLOCKED.some(d => parsed.hostname.includes(d)))
    return res.status(400).json({ error:'This platform uses DRM protection and cannot be downloaded.' });

  try {
    console.log('[info]', url.slice(0,80));
    const r = await execFileAsync(YTDLP, [
      '--dump-json','--no-playlist','--no-warnings','--skip-download',
      '--geo-bypass','--no-check-certificates',
      '--user-agent', UA,
      '--add-header','Accept-Language:en-US,en;q=0.9',
      url.trim()
    ], { timeout:TIMEOUT, maxBuffer:12*1024*1024 });

    const info    = JSON.parse(r.stdout);
    const formats = buildFormats(info, url);
    const ytId    = getYTId(url);

    res.json({
      success:  true,
      url:      url.trim(),
      platform: detectPlatform(url),
      media: {
        title:     info.title || 'Untitled',
        thumbnail: ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : (info.thumbnail || null),
        thumbnailFallback: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : null,
        duration:  fmtDur(info.duration),
        uploader:  info.uploader || info.channel || null,
        viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
        formats
      }
    });
  } catch (err) {
    console.error('[info error]', err.message?.slice(0,200));
    res.status(422).json({ error: friendlyError(err.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/download  — get direct stream URL
// ─────────────────────────────────────────────────────────────────────────────
router.post('/download', async (req, res) => {
  const { url, formatId, type, ext } = req.body;
  if (!url || !formatId) return res.status(400).json({ error:'url and formatId required.' });

  // Map our format IDs to yt-dlp format strings
  let fmtArg;
  if (formatId.startsWith('mp4-')) {
    const h = parseInt(formatId.replace('mp4-',''));
    fmtArg = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
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
    console.log('[download]', formatId, url.slice(0,60));
    const r = await execFileAsync(YTDLP, [
      '--get-url','--no-playlist','--no-warnings',
      '--geo-bypass','--no-check-certificates',
      '-f', fmtArg,
      '--user-agent', UA,
      url.trim()
    ], { timeout:TIMEOUT, maxBuffer:5*1024*1024 });

    const directUrl = r.stdout.trim().split('\n')[0];
    if (!directUrl) return res.status(500).json({ error:'Could not get download URL.' });

    res.json({ success:true, downloadUrl:directUrl, formatId, type:type||'video', ext:ext||'mp4' });
  } catch (err) {
    console.error('[download error]', err.message?.slice(0,150));
    res.status(500).json({ error: friendlyError(err.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy-download  — stream through server for forced download dialog
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy-download', async (req, res) => {
  const { url, filename, ext } = req.query;
  if (!url) return res.status(400).json({ error:'url param required' });

  let decoded;
  try { decoded = decodeURIComponent(url); new URL(decoded); }
  catch { return res.status(400).json({ error:'Invalid URL' }); }

  try {
    const fetch  = (await import('node-fetch')).default;
    const ups = await fetch(decoded, {
      headers: {
        'User-Agent':      UA,
        'Accept':          '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Range':           req.headers.range || 'bytes=0-',
        'Referer':         'https://www.youtube.com/'
      },
      redirect: 'follow'
    });

    if (!ups.ok && ups.status !== 206)
      return res.status(ups.status).json({ error:`Upstream ${ups.status}` });

    const safe = ((filename||'ps-download').replace(/[^\w\s.-]/g,'_')).slice(0,100);
    const fext = (ext||'mp4').replace(/[^\w]/g,'');

    res.setHeader('Content-Disposition', `attachment; filename="${safe}.${fext}"`);
    res.setHeader('Content-Type', ups.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const cl = ups.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    if (ups.status === 206) res.status(206);

    ups.body.pipe(res);
    ups.body.on('error', e => { console.error('[proxy stream]', e.message); });
  } catch (err) {
    console.error('[proxy]', err.message);
    if (!res.headersSent) res.status(500).json({ error:'Proxy failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/thumbnail-proxy
// ─────────────────────────────────────────────────────────────────────────────
router.get('/thumbnail-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();
  try {
    const fetch  = (await import('node-fetch')).default;
    const r = await fetch(decodeURIComponent(url), { headers:{'User-Agent':UA} });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch { res.status(500).end(); }
});

module.exports = router;
