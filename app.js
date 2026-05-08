'use strict';

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');
const { execFile } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── yt-dlp ──────────────────────────────────────────────────────────────────
const BIN = path.join(__dirname, 'bin', 'yt-dlp');
let ytReady = false;

function runYtdlp(args, cb) {
  const bin = fs.existsSync(BIN) ? BIN : 'yt-dlp';
  execFile(bin, args, { timeout: 40000, maxBuffer: 15 * 1024 * 1024 }, cb);
}

function downloadYtdlp(done) {
  if (fs.existsSync(BIN)) { ytReady = true; return done(null); }
  console.log('[yt-dlp] Downloading binary...');
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  function get(u, hops) {
    if (hops > 8) return done(new Error('redirect loop'));
    const file = fs.createWriteStream(BIN);
    https.get(u, { timeout: 120000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); try { fs.unlinkSync(BIN); } catch {}
        return get(res.headers.location, hops + 1);
      }
      if (res.statusCode !== 200) { file.close(); return done(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try { fs.chmodSync(BIN, '755'); } catch {}
        ytReady = true;
        console.log('[yt-dlp] Ready');
        done(null);
      }));
      file.on('error', e => { try { fs.unlinkSync(BIN); } catch {} done(e); });
    }).on('error', e => { try { fs.unlinkSync(BIN); } catch {} done(e); });
  }
  get(url, 0);
}

// Download yt-dlp in background at startup
downloadYtdlp(err => {
  if (err) console.log('[yt-dlp] Download failed:', err.message);
});

// ── Middleware ───────────────────────────────────────────────────────────────
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
  message: { error: 'Too many requests — wait a moment.' },
  skip: req => req.path === '/status'
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ── Helpers ──────────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';

function fmtSize(b) {
  if (!b) return null;
  return b < 1048576 ? Math.round(b/1024)+'KB' : (b/1048576).toFixed(1)+'MB';
}
function fmtDur(s) {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60);
  return h ? h+':'+String(m).padStart(2,'0')+':'+String(sc).padStart(2,'0') : m+':'+String(sc).padStart(2,'0');
}
function getPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url))  return 'YouTube';
  if (/tiktok\.com/i.test(url))             return 'TikTok';
  if (/instagram\.com/i.test(url))          return 'Instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'Facebook';
  if (/twitter\.com|x\.com/i.test(url))     return 'Twitter/X';
  if (/vimeo\.com/i.test(url))              return 'Vimeo';
  return 'Web Media';
}
function getYTId(url) {
  const m = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function niceError(msg) {
  if (!msg) return 'Could not fetch media.';
  if (/private/i.test(msg))               return 'This video is private.';
  if (/unavailable|not available/i.test(msg)) return 'Video not available in this region.';
  if (/age|sign in/i.test(msg))           return 'Age-restricted content.';
  if (/removed|deleted/i.test(msg))       return 'Video has been removed.';
  if (/Unsupported URL/i.test(msg))       return 'This URL is not supported.';
  if (/403/i.test(msg))                   return 'Access denied by platform.';
  if (/404/i.test(msg))                   return 'Video not found.';
  if (/timed?\s?out/i.test(msg))          return 'Request timed out — please try again.';
  if (/No such file|not found/i.test(msg)) return 'Media engine is starting up — try again in 30 seconds.';
  return 'Failed to process URL. Try again.';
}

const LADDER = [
  {h:1080,label:'1080p',tag:'FHD',icon:'🎬'},
  {h:720, label:'720p', tag:'HD', icon:'📹'},
  {h:480, label:'480p', tag:'SD', icon:'📺'},
  {h:360, label:'360p', tag:'SD', icon:'📺'},
  {h:240, label:'240p', tag:'LOW',icon:'📱'},
  {h:144, label:'144p', tag:'LOW',icon:'📱'},
];

function buildFormats(info, url) {
  const raw  = info.formats || [];
  const isYT = /youtube\.com|youtu\.be/i.test(url);
  const isTT = /tiktok\.com/i.test(url);
  const maxH = raw.reduce((m,f) => f.height&&f.height>m?f.height:m, 0);
  const out  = [];

  for (const q of LADDER) {
    const avail = maxH >= q.h * 0.6;
    if (!avail && !isYT) continue;
    const m = raw.filter(f => f.vcodec&&f.vcodec!=='none'&&f.height&&f.height<=q.h)
                 .sort((a,b)=>(b.height||0)-(a.height||0))[0];
    out.push({
      id: 'mp4-'+q.h, label: q.label+' (.mp4)', type:'video', ext:'mp4',
      quality: q.label, size: m ? fmtSize(m.filesize||m.filesize_approx) : null,
      fmtArg: 'bestvideo[height<='+q.h+'][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<='+q.h+']+bestaudio/best[height<='+q.h+']',
      tag: q.tag, icon: q.icon, available: avail
    });
  }

  if (isTT) {
    out.unshift({id:'nowm',label:'No Watermark (.mp4)',type:'video',ext:'mp4',
      quality:'Original',size:null,fmtArg:'download_addr-0/bestvideo[ext=mp4]/best',
      tag:'✨',icon:'✨',available:true});
  }

  const ar = raw.filter(f=>f.vcodec==='none'&&f.acodec&&f.acodec!=='none')
               .sort((a,b)=>(b.abr||0)-(a.abr||0));
  out.push({id:'mp3',label:'MP3 Audio (.mp3)',type:'audio',ext:'mp3',
    quality:'Best',size:ar[0]?fmtSize(ar[0].filesize):null,
    fmtArg:'bestaudio/best',tag:'MP3',icon:'🎵',available:true});

  return out;
}

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  runYtdlp(['--version'], (err, stdout) => {
    res.json({
      ok: true,
      ytdlp: !err,
      ytdlpVersion: err ? null : stdout.trim(),
      ytdlpPath: fs.existsSync(BIN) ? BIN : 'system',
      ready: ytReady
    });
  });
});

// ── POST /api/info ────────────────────────────────────────────────────────────
app.post('/api/info', (req, res) => {
  const url = (req.body && req.body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'URL required.' });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL.' }); }
  if (!['http:','https:'].includes(parsed.protocol))
    return res.status(400).json({ error: 'Only http/https URLs allowed.' });

  console.log('[info]', url.slice(0,80));

  const args = [
    '--dump-json', '--no-playlist', '--no-warnings', '--skip-download',
    '--geo-bypass', '--no-check-certificates',
    '--user-agent', UA,
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    url
  ];

  runYtdlp(args, (err, stdout) => {
    if (err) {
      console.error('[info error]', err.message.slice(0,200));
      return res.status(422).json({ error: niceError(err.message) });
    }
    let info;
    try { info = JSON.parse(stdout); }
    catch(e) { return res.status(500).json({ error: 'Parse error.' }); }

    const ytId = getYTId(url);
    const formats = buildFormats(info, url);

    res.json({
      success: true,
      platform: getPlatform(url),
      media: {
        title:    info.title    || 'Untitled',
        thumbnail: ytId ? 'https://i.ytimg.com/vi/'+ytId+'/hqdefault.jpg' : (info.thumbnail||null),
        duration: fmtDur(info.duration),
        uploader: info.uploader || info.channel || null,
        viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
        formats
      }
    });
  });
});

// ── POST /api/download ────────────────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { url, fmtArg, ext } = req.body || {};
  if (!url || !fmtArg) return res.status(400).json({ error: 'url and fmtArg required.' });

  console.log('[download]', fmtArg.slice(0,40), url.slice(0,60));

  const args = [
    '--get-url', '--no-playlist', '--no-warnings',
    '--geo-bypass', '--no-check-certificates',
    '-f', fmtArg,
    '--user-agent', UA,
    url
  ];

  runYtdlp(args, (err, stdout) => {
    if (err) {
      console.error('[download error]', err.message.slice(0,150));
      return res.status(500).json({ error: niceError(err.message) });
    }
    const dlUrl = stdout.trim().split('\n')[0];
    if (!dlUrl) return res.status(500).json({ error: 'No download URL found.' });
    res.json({ success: true, url: dlUrl, ext: ext || 'mp4' });
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('PS Downloader running on port ' + PORT);
});
