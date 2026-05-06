'use strict';
const express  = require('express');
const router   = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const exec     = promisify(execFile);

const TIMEOUT  = 35000;
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
const BIN      = path.join(__dirname, '..', 'bin', 'yt-dlp');
let YTDLP      = null;
let YT_READY   = false;

/* ─── auto-download yt-dlp binary at runtime ─── */
async function getYtdlp() {
  if (YT_READY) return YTDLP;

  // 1. local bin/
  if (fs.existsSync(BIN)) {
    try {
      await exec(BIN, ['--version'], { timeout: 5000 });
      YTDLP = BIN; YT_READY = true; return YTDLP;
    } catch { try { fs.unlinkSync(BIN); } catch {} }
  }

  // 2. system PATH
  try {
    await exec('yt-dlp', ['--version'], { timeout: 5000 });
    YTDLP = 'yt-dlp'; YT_READY = true; return YTDLP;
  } catch {}

  // 3. download linux binary from GitHub
  console.log('[yt-dlp] Downloading binary...');
  const dir = path.dirname(BIN);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await new Promise((resolve, reject) => {
    function get(url, n) {
      if (n > 8) return reject(new Error('Too many redirects'));
      const file = fs.createWriteStream(BIN);
      https.get(url, { timeout: 120000 }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          try { fs.unlinkSync(BIN); } catch {}
          return get(res.headers.location, n + 1);
        }
        if (res.statusCode !== 200) { file.close(); return reject(new Error('HTTP ' + res.statusCode)); }
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          try { fs.chmodSync(BIN, '755'); } catch {}
          resolve();
        }));
        file.on('error', e => { try { fs.unlinkSync(BIN); } catch {} reject(e); });
      }).on('error', e => { try { fs.unlinkSync(BIN); } catch {} reject(e); });
    }
    get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', 0);
  });

  await exec(BIN, ['--version'], { timeout: 8000 });
  YTDLP = BIN; YT_READY = true;
  console.log('[yt-dlp] Ready');
  return YTDLP;
}

// warm up in background
getYtdlp().catch(e => console.log('[yt-dlp] warmup:', e.message));

/* ─── helpers ─── */
const sz = b => !b ? null : b < 1048576 ? Math.round(b/1024)+' KB' : (b/1048576).toFixed(1)+' MB';
const dd = s => {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}` : `${m}:${String(sc).padStart(2,'0')}`;
};
const plat = u => {
  if (/youtube\.com|youtu\.be/i.test(u))  return {name:'YouTube',  icon:'▶'};
  if (/tiktok\.com/i.test(u))             return {name:'TikTok',   icon:'♪'};
  if (/instagram\.com/i.test(u))          return {name:'Instagram',icon:'📸'};
  if (/facebook\.com|fb\.watch/i.test(u)) return {name:'Facebook', icon:'👥'};
  if (/twitter\.com|x\.com/i.test(u))     return {name:'Twitter/X',icon:'𝕏'};
  if (/vimeo\.com/i.test(u))              return {name:'Vimeo',    icon:'🎬'};
  return {name:'Web Media',icon:'🌐'};
};
const ytid = u => { const m=u.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m?m[1]:null; };
const oops = msg => {
  if (!msg) return 'Could not fetch media.';
  if (/private/i.test(msg))                   return 'This video is private.';
  if (/not available|unavailable/i.test(msg)) return 'Video unavailable in this region.';
  if (/age|sign in/i.test(msg))               return 'Age-restricted content.';
  if (/removed|deleted/i.test(msg))           return 'Video has been removed.';
  if (/Unsupported URL/i.test(msg))           return 'Unsupported URL.';
  if (/403/i.test(msg))                       return 'Access denied (403).';
  if (/404/i.test(msg))                       return 'Not found (404).';
  if (/timed?\s*out/i.test(msg))              return 'Timed out — try again.';
  if (/No such file|not found/i.test(msg))    return 'Media engine starting — try again shortly.';
  return 'Failed. Check URL and try again.';
};

/* ─── format ladder ─── */
const LADDER = [
  {h:2160,label:'4K 2160p', tag:'4K', icon:'🎯'},
  {h:1440,label:'QHD 1440p',tag:'QHD',icon:'🎬'},
  {h:1080,label:'1080p',    tag:'FHD',icon:'🎬'},
  {h:720, label:'720p',     tag:'HD', icon:'📹'},
  {h:480, label:'480p',     tag:'SD', icon:'📺'},
  {h:360, label:'360p',     tag:'SD', icon:'📺'},
  {h:240, label:'240p',     tag:'LOW',icon:'📱'},
  {h:144, label:'144p',     tag:'LOW',icon:'📱'},
];

function buildFormats(info, url) {
  const raw  = info.formats || [];
  const isYT = /youtube\.com|youtu\.be/i.test(url);
  const isTT = /tiktok\.com/i.test(url);
  const maxH = raw.reduce((m,f) => f.height&&f.height>m ? f.height : m, 0);
  const out  = [];

  for (const q of LADDER) {
    const avail = maxH >= q.h * 0.65;
    if (!avail && !isYT) continue;
    const m = raw.filter(f => f.vcodec&&f.vcodec!=='none'&&f.height&&f.height<=q.h)
                 .sort((a,b) => (b.height||0)-(a.height||0))[0];
    out.push({
      id: `mp4-${q.h}`, label: `${q.label} (.mp4)`, type: 'video', ext: 'mp4',
      quality: q.label, size: m ? sz(m.filesize||m.filesize_approx) : null,
      format_id: `bestvideo[height<=${q.h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q.h}]+bestaudio/best[height<=${q.h}]`,
      tag: q.tag, icon: q.icon, available: avail
    });
  }

  if (isTT) out.unshift({id:'nowm',label:'No Watermark (.mp4)',type:'video',ext:'mp4',quality:'Original',size:null,format_id:'download_addr-0/bestvideo[ext=mp4]/best',tag:'✨',icon:'✨',available:true});

  const ar = raw.filter(f=>f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0));
  out.push({id:'mp3-320',label:'MP3 320kbps (.mp3)',type:'audio',ext:'mp3',quality:'320kbps',size:ar[0]?sz(ar[0].filesize):null,format_id:'bestaudio/best',tag:'MP3',icon:'🎵',available:true});
  out.push({id:'mp3-128',label:'MP3 128kbps (.mp3)',type:'audio',ext:'mp3',quality:'128kbps',size:null,format_id:'worstaudio[acodec!=none]/worst',tag:'MP3',icon:'🎵',available:true});
  return out;
}

/* ─── GET /api/status ─── */
router.get('/status', async (_q, res) => {
  let ok=false, ver=null;
  try { const yt=await getYtdlp(); const r=await exec(yt,['--version'],{timeout:6000}); ok=true; ver=r.stdout.trim(); } catch(e){ console.log('[status]',e.message.slice(0,80)); }
  res.json({status:'ok',version:'1.0.0',ytdlp:ok,ytdlpVersion:ver,ytdlpPath:YTDLP||'pending',platforms:['YouTube','TikTok','Instagram','Facebook','Twitter/X','Vimeo','1000+ more']});
});

/* ─── POST /api/info ─── */
router.post('/info', async (req, res) => {
  let url = (req.body||{}).url;
  if (!url) return res.status(400).json({error:'URL required.'});
  url = url.trim();
  try { const p=new URL(url); if (!['http:','https:'].includes(p.protocol)) throw 0; }
  catch { return res.status(400).json({error:'Invalid URL.'}); }
  const DRM = ['netflix.com','spotify.com','disneyplus.com','hulu.com','primevideo.com'];
  if (DRM.some(d => new URL(url).hostname.includes(d))) return res.status(400).json({error:'DRM-protected platform.'});

  try {
    const yt = await getYtdlp();
    console.log('[info]', url.slice(0,80));
    const r = await exec(yt, ['--dump-json','--no-playlist','--no-warnings','--skip-download','--geo-bypass','--no-check-certificates','--user-agent',UA,'--add-header','Accept-Language:en-US,en;q=0.9',url], {timeout:TIMEOUT,maxBuffer:12*1024*1024});
    const info=JSON.parse(r.stdout), id=ytid(url);
    res.json({success:true,url,platform:plat(url),media:{
      title:info.title||'Untitled',
      thumbnail:id?`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`:(info.thumbnail||null),
      thumbnailFallback:id?`https://i.ytimg.com/vi/${id}/hqdefault.jpg`:null,
      duration:dd(info.duration),uploader:info.uploader||info.channel||null,
      viewCount:info.view_count?Number(info.view_count).toLocaleString():null,
      formats:buildFormats(info,url)
    }});
  } catch(e) { console.error('[info]',e.message?.slice(0,200)); res.status(422).json({error:oops(e.message)}); }
});

/* ─── POST /api/download ─── */
router.post('/download', async (req, res) => {
  const {url,formatId,type,ext} = req.body||{};
  if (!url||!formatId) return res.status(400).json({error:'url and formatId required.'});
  let fa;
  if (formatId.startsWith('mp4-'))  { const h=parseInt(formatId.replace('mp4-','')); fa=`bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`; }
  else if (formatId==='mp3-320')    fa='bestaudio/best';
  else if (formatId==='mp3-128')    fa='worstaudio[acodec!=none]/worst';
  else if (formatId==='nowm')       fa='download_addr-0/bestvideo[ext=mp4]/best';
  else                              fa=formatId;
  try {
    const yt=await getYtdlp();
    console.log('[dl]',formatId,url.slice(0,60));
    const r=await exec(yt,['--get-url','--no-playlist','--no-warnings','--geo-bypass','--no-check-certificates','-f',fa,'--user-agent',UA,url.trim()],{timeout:TIMEOUT,maxBuffer:5*1024*1024});
    const dl=r.stdout.trim().split('\n')[0];
    if (!dl) return res.status(500).json({error:'No download URL found.'});
    res.json({success:true,downloadUrl:dl,formatId,type:type||'video',ext:ext||'mp4'});
  } catch(e) { console.error('[dl]',e.message?.slice(0,150)); res.status(500).json({error:oops(e.message)}); }
});

/* ─── GET /api/proxy-download ─── */
router.get('/proxy-download', async (req, res) => {
  const {url,filename,ext} = req.query;
  if (!url) return res.status(400).json({error:'url required'});
  let dec;
  try { dec=decodeURIComponent(url); new URL(dec); } catch { return res.status(400).json({error:'Invalid URL'}); }
  try {
    const fetch=(await import('node-fetch')).default;
    const up=await fetch(dec,{headers:{'User-Agent':UA,'Accept':'*/*','Range':req.headers.range||'bytes=0-','Referer':'https://www.youtube.com/'},redirect:'follow'});
    if (!up.ok&&up.status!==206) return res.status(up.status).json({error:'Upstream '+up.status});
    const safe=((filename||'download').replace(/[^\w\s.-]/g,'_')).slice(0,100);
    const fe=(ext||'mp4').replace(/[^\w]/g,'');
    res.setHeader('Content-Disposition',`attachment; filename="${safe}.${fe}"`);
    res.setHeader('Content-Type',up.headers.get('content-type')||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    const cl=up.headers.get('content-length'); if (cl) res.setHeader('Content-Length',cl);
    if (up.status===206) res.status(206);
    up.body.pipe(res);
  } catch(e) { if (!res.headersSent) res.status(500).json({error:'Proxy failed.'}); }
});

module.exports = router;
