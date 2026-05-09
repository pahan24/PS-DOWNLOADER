'use strict';

var express   = require('express');
var cors      = require('cors');
var helmet    = require('helmet');
var rateLimit = require('express-rate-limit');
var path      = require('path');
var fs        = require('fs');
var https     = require('https');
var execFile  = require('child_process').execFile;

var app  = express();
var PORT = process.env.PORT || 3000;
var UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
var BIN  = path.join(__dirname, 'bin', 'yt-dlp');

// ── Find yt-dlp ───────────────────────────────────────────────────────────────
var YTBIN = null;

function findYtdlp(cb) {
  if (YTBIN) return cb(null, YTBIN);

  // 1. local bin/
  if (fs.existsSync(BIN)) {
    execFile(BIN, ['--version'], { timeout: 6000 }, function(err) {
      if (!err) { YTBIN = BIN; return cb(null, YTBIN); }
      try { fs.unlinkSync(BIN); } catch(e) {}
      trySystem(cb);
    });
    return;
  }
  trySystem(cb);
}

function trySystem(cb) {
  // 2. system PATH
  execFile('yt-dlp', ['--version'], { timeout: 6000 }, function(err) {
    if (!err) { YTBIN = 'yt-dlp'; return cb(null, YTBIN); }
    downloadYtdlp(cb);
  });
}

function downloadYtdlp(cb) {
  // 3. Download binary
  console.log('[yt-dlp] Downloading...');
  var dir = path.dirname(BIN);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
  }

  var url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  var tmp = BIN + '.tmp';

  function get(u, hops) {
    if (hops > 8) return cb(new Error('Too many redirects'));
    var file = fs.createWriteStream(tmp);
    https.get(u, { timeout: 120000 }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); try { fs.unlinkSync(tmp); } catch(e) {}
        return get(res.headers.location, hops + 1);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(tmp); } catch(e) {}
        return cb(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', function() {
        file.close(function() {
          try {
            fs.renameSync(tmp, BIN);
            fs.chmodSync(BIN, '755');
          } catch(e) {}
          YTBIN = BIN;
          console.log('[yt-dlp] Downloaded successfully');
          cb(null, YTBIN);
        });
      });
      file.on('error', function(e) {
        try { fs.unlinkSync(tmp); } catch(ex) {}
        cb(e);
      });
    }).on('error', function(e) {
      try { fs.unlinkSync(tmp); } catch(ex) {}
      cb(e);
    });
  }
  get(url, 0);
}

function runYtdlp(args, cb) {
  findYtdlp(function(err, bin) {
    if (err || !bin) return cb(new Error('yt-dlp not available. Try again in 30 seconds.'));
    execFile(bin, args, { timeout: 45000, maxBuffer: 20 * 1024 * 1024 }, cb);
  });
}

// Warm up in background
findYtdlp(function(err, bin) {
  if (err) console.log('[yt-dlp] Warmup failed:', err.message);
  else     console.log('[yt-dlp] Ready at:', bin);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
var fmtSz = function(b) { if (!b) return null; return b < 1048576 ? Math.round(b/1024)+'KB' : (b/1048576).toFixed(1)+'MB'; };
var fmtDr = function(s) { if (!s) return null; var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60); return h ? h+':'+String(m).padStart(2,'0')+':'+String(sc).padStart(2,'0') : m+':'+String(sc).padStart(2,'0'); };
var getPlt = function(u) {
  if (/youtube\.com|youtu\.be/i.test(u))  return 'YouTube';
  if (/tiktok\.com/i.test(u))             return 'TikTok';
  if (/instagram\.com/i.test(u))          return 'Instagram';
  if (/facebook\.com|fb\.watch/i.test(u)) return 'Facebook';
  if (/twitter\.com|x\.com/i.test(u))     return 'Twitter/X';
  if (/vimeo\.com/i.test(u))              return 'Vimeo';
  return 'Web Media';
};
var getYTId = function(u) { var m=u.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m?m[1]:null; };
var niceErr = function(msg) {
  if (!msg) return 'Could not fetch media.';
  if (/private/i.test(msg))                   return 'This video is private.';
  if (/not available|unavailable/i.test(msg)) return 'Video unavailable in this region.';
  if (/age|sign in/i.test(msg))               return 'Age-restricted content.';
  if (/removed|deleted/i.test(msg))           return 'Video has been removed.';
  if (/Unsupported URL/i.test(msg))           return 'This URL is not supported.';
  if (/403/i.test(msg))                       return 'Access denied by platform.';
  if (/404/i.test(msg))                       return 'Video not found.';
  if (/timed?\s*out/i.test(msg))              return 'Timed out - please try again.';
  if (/not available|ENOENT|not found/i.test(msg)) return 'Media engine starting up. Wait 30 seconds and try again.';
  return 'Failed to process URL. Please try again.';
};

var LADDER = [
  {h:1080,label:'1080p',tag:'FHD',icon:'🎬'},
  {h:720, label:'720p', tag:'HD', icon:'📹'},
  {h:480, label:'480p', tag:'SD', icon:'📺'},
  {h:360, label:'360p', tag:'SD', icon:'📺'},
  {h:240, label:'240p', tag:'LOW',icon:'📱'},
  {h:144, label:'144p', tag:'LOW',icon:'📱'}
];

function buildFormats(info, url) {
  var raw  = info.formats || [];
  var isYT = /youtube\.com|youtu\.be/i.test(url);
  var isTT = /tiktok\.com/i.test(url);
  var maxH = raw.reduce(function(m,f){return f.height&&f.height>m?f.height:m;},0);
  var out  = [];

  LADDER.forEach(function(q) {
    var avail = maxH >= q.h * 0.6;
    if (!avail && !isYT) return;
    var m = raw.filter(function(f){return f.vcodec&&f.vcodec!=='none'&&f.height&&f.height<=q.h;})
               .sort(function(a,b){return (b.height||0)-(a.height||0);})[0];
    out.push({
      id: 'mp4-'+q.h, label: q.label+' (.mp4)', type:'video', ext:'mp4',
      quality: q.label, size: m?fmtSz(m.filesize||m.filesize_approx):null,
      fmtArg: 'bestvideo[height<='+q.h+'][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<='+q.h+']+bestaudio/best[height<='+q.h+']',
      tag: q.tag, icon: q.icon, available: avail
    });
  });

  if (isTT) out.unshift({id:'nowm',label:'No Watermark (.mp4)',type:'video',ext:'mp4',quality:'Original',size:null,fmtArg:'download_addr-0/bestvideo[ext=mp4]/best',tag:'✨',icon:'✨',available:true});

  var ar=raw.filter(function(f){return f.vcodec==='none'&&f.acodec&&f.acodec!=='none';}).sort(function(a,b){return (b.abr||0)-(a.abr||0);});
  out.push({id:'mp3',label:'MP3 Audio (.mp3)',type:'audio',ext:'mp3',quality:'Best',size:ar[0]?fmtSz(ar[0].filesize):null,fmtArg:'bestaudio/best',tag:'MP3',icon:'🎵',available:true});
  return out;
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
      styleSrc:   ["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://fonts.gstatic.com"],
      fontSrc:    ["'self'","https://fonts.gstatic.com"],
      imgSrc:     ["'self'","data:","https:","blob:"],
      connectSrc: ["'self'"],
      mediaSrc:   ["'self'","blob:","https:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.options('*', cors());
app.use(express.json({limit:'1mb'}));
app.use('/api', rateLimit({windowMs:60000,max:40,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests.'},skip:function(req){return req.path==='/status';}}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h'}));

// ── GET /api/status ───────────────────────────────────────────────────────────
app.get('/api/status', function(req, res) {
  findYtdlp(function(err, bin) {
    if (err || !bin) return res.json({ok:true,ytdlp:false,version:null,path:'none'});
    execFile(bin,['--version'],{timeout:6000},function(er,stdout){
      res.json({ok:true,ytdlp:!er,version:er?null:stdout.trim(),path:bin});
    });
  });
});

// ── POST /api/info ────────────────────────────────────────────────────────────
app.post('/api/info', function(req, res) {
  var url = ((req.body||{}).url||'').trim();
  if (!url) return res.status(400).json({error:'URL required.'});
  try { new URL(url); } catch(e) { return res.status(400).json({error:'Invalid URL.'}); }

  console.log('[info]', url.slice(0,80));

  runYtdlp([
    '--dump-json','--no-playlist','--no-warnings','--skip-download',
    '--geo-bypass','--no-check-certificates',
    '--user-agent', UA,
    '--add-header','Accept-Language:en-US,en;q=0.9',
    url
  ], function(err, stdout) {
    if (err) { console.error('[info err]', err.message.slice(0,200)); return res.status(422).json({error:niceErr(err.message)}); }
    var info;
    try { info = JSON.parse(stdout); } catch(e) { return res.status(500).json({error:'Parse error.'}); }
    var ytId = getYTId(url);
    res.json({
      success: true,
      platform: getPlt(url),
      media: {
        title:    info.title||'Untitled',
        thumbnail: ytId ? 'https://i.ytimg.com/vi/'+ytId+'/hqdefault.jpg' : (info.thumbnail||null),
        duration:  fmtDr(info.duration),
        uploader:  info.uploader||info.channel||null,
        viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
        formats:   buildFormats(info, url)
      }
    });
  });
});

// ── POST /api/download ────────────────────────────────────────────────────────
app.post('/api/download', function(req, res) {
  var body   = req.body || {};
  var url    = body.url;
  var fmtArg = body.fmtArg;
  var ext    = body.ext || 'mp4';

  if (!url || !fmtArg) return res.status(400).json({error:'url and fmtArg required.'});
  console.log('[dl]', fmtArg.slice(0,40), url.slice(0,50));

  runYtdlp([
    '--get-url','--no-playlist','--no-warnings',
    '--geo-bypass','--no-check-certificates',
    '-f', fmtArg,
    '--user-agent', UA,
    url
  ], function(err, stdout) {
    if (err) { console.error('[dl err]', err.message.slice(0,150)); return res.status(500).json({error:niceErr(err.message)}); }
    var dlUrl = stdout.trim().split('\n')[0];
    if (!dlUrl) return res.status(500).json({error:'No download URL found.'});
    res.json({success:true, url:dlUrl, ext:ext});
  });
});

// ── SPA ───────────────────────────────────────────────────────────────────────
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('PS Downloader running on port ' + PORT);
});
