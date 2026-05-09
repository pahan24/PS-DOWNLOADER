'use strict';

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');
const { execFile, exec } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';

// ─── yt-dlp setup ────────────────────────────────────────────────────────────
// Try multiple install methods so it works on Heroku
const BIN = path.join(__dirname, 'bin', 'yt-dlp');
let YTDLP = null;  // resolved path

async function resolveYtdlp() {
  const { promisify } = require('util');
  const execP = promisify(exec);

  // 1. Already resolved
  if (YTDLP) return YTDLP;

  // 2. Check npm-installed yt-dlp-wrap binary
  try {
    const wrap = require('yt-dlp-wrap');
    const inst = new wrap.default ? new wrap.default() : new wrap();
    const binPath = inst.ytDlpPath || inst._ytDlpPath;
    if (binPath && fs.existsSync(binPath)) {
      await execP(`"${binPath}" --version`);
      YTDLP = binPath;
      console.log('[yt-dlp] Using yt-dlp-wrap binary:', binPath);
      return YTDLP;
    }
  } catch {}

  // 3. Local bin/
  if (fs.existsSync(BIN)) {
    try { await execP(`"${BIN}" --version`); YTDLP = BIN; return YTDLP; }
    catch { try { fs.unlinkSync(BIN); } catch {} }
  }

  // 4. System PATH
  try { await execP('yt-dlp --version'); YTDLP = 'yt-dlp'; return YTDLP; }
  catch {}

  // 5. pip install
  try {
    console.log('[yt-dlp] Trying pip install...');
    await execP('pip3 install -q yt-dlp || pip install -q yt-dlp');
    await execP('yt-dlp --version');
    YTDLP = 'yt-dlp';
    console.log('[yt-dlp] pip install succeeded');
    return YTDLP;
  } catch {}

  // 6. Download binary
  try {
    console.log('[yt-dlp] Downloading binary from GitHub...');
    await downloadBin();
    YTDLP = BIN;
    return YTDLP;
  } catch(e) {
    console.error('[yt-dlp] All install methods failed:', e.message);
  }

  return null;
}

function downloadBin() {
  return new Promise((resolve, reject) => {
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    const dir = path.dirname(BIN);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    function get(u, hops) {
      if (hops > 8) return reject(new Error('Too many redirects'));
      const f = fs.createWriteStream(BIN);
      https.get(u, { timeout: 120000 }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          f.close(); try { fs.unlinkSync(BIN); } catch {}
          return get(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) { f.close(); return reject(new Error('HTTP ' + res.statusCode)); }
        res.pipe(f);
        f.on('finish', () => f.close(() => {
          try { fs.chmodSync(BIN, '755'); } catch {}
          resolve();
        }));
        f.on('error', e => { try { fs.unlinkSync(BIN); } catch {} reject(e); });
      }).on('error', e => { try { fs.unlinkSync(BIN); } catch {} reject(e); });
    }
    get(url, 0);
  });
}

function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const bin = YTDLP || 'yt-dlp';
    execFile(bin, args, { timeout: 45000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(err.message + '\n' + stderr));
      else resolve(stdout);
    });
  });
}

// Warm up yt-dlp in background
resolveYtdlp().then(p => {
  if (p) console.log('[yt-dlp] Ready at:', p);
  else    console.log('[yt-dlp] Not found — will retry on first request');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtSz = b => !b ? null : b < 1048576 ? Math.round(b/1024)+'KB' : (b/1048576).toFixed(1)+'MB';
const fmtDr = s => {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}` : `${m}:${String(sc).padStart(2,'0')}`;
};
const getPlt = u => {
  if (/youtube\.com|youtu\.be/i.test(u))  return 'YouTube';
  if (/tiktok\.com/i.test(u))             return 'TikTok';
  if (/instagram\.com/i.test(u))          return 'Instagram';
  if (/facebook\.com|fb\.watch/i.test(u)) return 'Facebook';
  if (/twitter\.com|x\.com/i.test(u))     return 'Twitter/X';
  if (/vimeo\.com/i.test(u))              return 'Vimeo';
  return 'Web Media';
};
const getYTId = u => { const m = u.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m?m[1]:null; };
const niceErr = msg => {
  if (!msg) return 'Could not fetch media.';
  if (/private/i.test(msg))                    return 'This video is private.';
  if (/not available|unavailable/i.test(msg))  return 'Video unavailable in this region.';
  if (/age|sign in/i.test(msg))                return 'Age-restricted content.';
  if (/removed|deleted/i.test(msg))            return 'Video has been removed.';
  if (/Unsupported URL/i.test(msg))            return 'This URL is not supported.';
  if (/403/i.test(msg))                        return 'Access denied by platform.';
  if (/404/i.test(msg))                        return 'Video not found.';
  if (/timed?\s*out/i.test(msg))               return 'Timed out — please try again.';
  if (/No such file|not found|ENOENT/i.test(msg)) return 'Media engine is starting — wait 30 seconds and try again.';
  return 'Failed to process URL. Please try again.';
};

const LADDER = [
  { h:1080, label:'1080p', tag:'FHD', icon:'🎬' },
  { h:720,  label:'720p',  tag:'HD',  icon:'📹' },
  { h:480,  label:'480p',  tag:'SD',  icon:'📺' },
  { h:360,  label:'360p',  tag:'SD',  icon:'📺' },
  { h:240,  label:'240p',  tag:'LOW', icon:'📱' },
  { h:144,  label:'144p',  tag:'LOW', icon:'📱' },
];

function buildFormats(info, url) {
  const raw  = info.formats || [];
  const isYT = /youtube\.com|youtu\.be/i.test(url);
  const isTT = /tiktok\.com/i.test(url);
  const maxH = raw.reduce((m, f) => f.height && f.height > m ? f.height : m, 0);
  const out  = [];

  for (const q of LADDER) {
    const avail = maxH >= q.h * 0.6;
    if (!avail && !isYT) continue;
    const m = raw.filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.height <= q.h)
                 .sort((a, b) => (b.height||0) - (a.height||0))[0];
    out.push({
      id:      `mp4-${q.h}`,
      label:   `${q.label} (.mp4)`,
      type:    'video',
      ext:     'mp4',
      quality: q.label,
      size:    m ? fmtSz(m.filesize || m.filesize_approx) : null,
      fmtArg:  `bestvideo[height<=${q.h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q.h}]+bestaudio/best[height<=${q.h}]`,
      tag:     q.tag,
      icon:    q.icon,
      available: avail
    });
  }

  if (isTT) {
    out.unshift({
      id:'nowm', label:'No Watermark (.mp4)', type:'video', ext:'mp4',
      quality:'Original', size:null,
      fmtArg:'download_addr-0/bestvideo[ext=mp4]/best',
      tag:'✨', icon:'✨', available:true
    });
  }

  const ar = raw.filter(f => f.vcodec==='none' && f.acodec && f.acodec!=='none')
               .sort((a, b) => (b.abr||0) - (a.abr||0));
  out.push({
    id:'mp3', label:'MP3 Audio (.mp3)', type:'audio', ext:'mp3',
    quality:'Best Quality', size: ar[0] ? fmtSz(ar[0].filesize) : null,
    fmtArg:'bestaudio/best',
    tag:'MP3', icon:'🎵', available:true
  });

  return out;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc:   ["'self'", "blob:", "https:"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.options('*', cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api', rateLimit({
  windowMs: 60000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests.' },
  skip: req => req.path === '/status'
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ─── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  let ytOk = false, ytVer = null;
  try {
    const bin = await resolveYtdlp();
    if (bin) {
      const out = await runYtdlp(['--version']);
      ytOk = true; ytVer = out.trim();
    }
  } catch {}
  res.json({ ok: true, ytdlp: ytOk, version: ytVer, path: YTDLP || 'none' });
});

// ─── POST /api/info ───────────────────────────────────────────────────────────
app.post('/api/info', async (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ error: 'URL required.' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL.' }); }

  try {
    const bin = await resolveYtdlp();
    if (!bin) return res.status(503).json({ error: 'Media engine not ready. Please wait 30 seconds and try again.' });

    console.log('[info]', url.slice(0, 80));
    const stdout = await runYtdlp([
      '--dump-json', '--no-playlist', '--no-warnings', '--skip-download',
      '--geo-bypass', '--no-check-certificates',
      '--user-agent', UA,
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      url
    ]);

    const info = JSON.parse(stdout);
    const ytId = getYTId(url);

    res.json({
      success: true,
      platform: getPlt(url),
      media: {
        title:     info.title || 'Untitled',
        thumbnail: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : (info.thumbnail || null),
        duration:  fmtDr(info.duration),
        uploader:  info.uploader || info.channel || null,
        viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
        formats:   buildFormats(info, url)
      }
    });
  } catch (e) {
    console.error('[info err]', e.message.slice(0, 200));
    res.status(422).json({ error: niceErr(e.message) });
  }
});

// ─── POST /api/download ───────────────────────────────────────────────────────
app.post('/api/download', async (req, res) => {
  const { url, fmtArg, ext } = req.body || {};
  if (!url || !fmtArg) return res.status(400).json({ error: 'url and fmtArg required.' });

  try {
    const bin = await resolveYtdlp();
    if (!bin) return res.status(503).json({ error: 'Media engine not ready. Please try again in 30 seconds.' });

    console.log('[download]', fmtArg.slice(0, 40), url.slice(0, 50));
    const stdout = await runYtdlp([
      '--get-url', '--no-playlist', '--no-warnings',
      '--geo-bypass', '--no-check-certificates',
      '-f', fmtArg,
      '--user-agent', UA,
      url
    ]);

    const dlUrl = stdout.trim().split('\n')[0];
    if (!dlUrl) return res.status(500).json({ error: 'No download URL found.' });
    res.json({ success: true, url: dlUrl, ext: ext || 'mp4' });
  } catch (e) {
    console.error('[dl err]', e.message.slice(0, 150));
    res.status(500).json({ error: niceErr(e.message) });
  }
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PS Downloader running on port ${PORT}`);
});
