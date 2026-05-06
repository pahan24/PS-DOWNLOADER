'use strict';

const express       = require('express');
const router        = express.Router();
const { execFile }  = require('child_process');
const { promisify } = require('util');
const path          = require('path');
const fs            = require('fs');
const https         = require('https');

const execFileAsync = promisify(execFile);
const TIMEOUT  = 35000;
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
const BIN_DIR  = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'yt-dlp');

let YTDLP      = 'yt-dlp';
let ytdlpReady = false;

async function ensureYtdlp() {
  if (ytdlpReady) return YTDLP;
  if (fs.existsSync(BIN_PATH)) {
    try { await execFileAsync(BIN_PATH, ['--version'], {timeout:5000}); YTDLP=BIN_PATH; ytdlpReady=true; return YTDLP; }
    catch { try { fs.unlinkSync(BIN_PATH); } catch {} }
  }
  try { await execFileAsync('yt-dlp', ['--version'], {timeout:5000}); ytdlpReady=true; return YTDLP; }
  catch {}
  console.log('[yt-dlp] Downloading binary...');
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, {recursive:true});
  const dlUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  await new Promise((resolve, reject) => {
    function get(u, hops) {
      if (hops > 8) return reject(new Error('Too many redirects'));
      const file = fs.createWriteStream(BIN_PATH);
      https.get(u, {timeout:120000}, res => {
        if (res.statusCode===301||res.statusCode===302) { file.close(); try{fs.unlinkSync(BIN_PATH);}catch{} return get(res.headers.location, hops+1); }
        if (res.statusCode!==200) { file.close(); return reject(new Error('HTTP '+res.statusCode)); }
        res.pipe(file);
        file.on('finish', () => file.close(() => { try{fs.chmodSync(BIN_PATH,'755');}catch{} resolve(); }));
        file.on('error', e => { try{fs.unlinkSync(BIN_PATH);}catch{} reject(e); });
      }).on('error', e => { try{fs.unlinkSync(BIN_PATH);}catch{} reject(e); });
    }
    get(dlUrl, 0);
  });
  await execFileAsync(BIN_PATH, ['--version'], {timeout:5000});
  YTDLP=BIN_PATH; ytdlpReady=true;
  console.log('[yt-dlp] Ready');
  return YTDLP;
}

ensureYtdlp().catch(e => console.log('[yt-dlp] Setup failed:', e.message));

const fmtSize = b => !b?null:(b<1048576?Math.round(b/1024)+' KB':(b/1048576).toFixed(1)+' MB');
const fmtDur  = s => { if(!s)return null; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`; };
const detectPlatform = url => {
  if (/youtube\.com|youtu\.be/i.test(url))  return {name:'YouTube',  icon:'▶'};
  if (/tiktok\.com/i.test(url))             return {name:'TikTok',   icon:'♪'};
  if (/instagram\.com/i.test(url))          return {name:'Instagram',icon:'📸'};
  if (/facebook\.com|fb\.watch/i.test(url)) return {name:'Facebook', icon:'👥'};
  if (/twitter\.com|x\.com/i.test(url))     return {name:'Twitter/X',icon:'𝕏'};
  if (/reddit\.com|v\.redd\.it/i.test(url)) return {name:'Reddit',   icon:'🤖'};
  if (/vimeo\.com/i.test(url))              return {name:'Vimeo',    icon:'🎬'};
  return {name:'Web Media',icon:'🌐'};
};
const getYTId = url => { const m=url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m?m[1]:null; };
const friendlyError = msg => {
  if (!msg) return 'Could not fetch media info.';
  if (/private/i.test(msg))                   return 'This video is private.';
  if (/not available|unavailable/i.test(msg)) return 'Video unavailable in this region.';
  if (/age|sign in/i.test(msg))               return 'Age-restricted content.';
  if (/removed|deleted/i.test(msg))           return 'Video has been removed.';
  if (/Unsupported URL/i.test(msg))           return 'Unsupported URL.';
  if (/403/i.test(msg))                       return 'Access denied (403).';
  if (/404/i.test(msg))                       return 'Not found (404).';
  if (/timed?\s*out/i.test(msg))              return 'Timed out — try again.';
  if (/No such file|not found/i.test(msg))    return 'Media engine not ready — try again shortly.';
  return 'Failed to fetch media. Check URL and try again.';
};

const VIDEO_LADDER = [
  {h:2160,label:'4K 2160p', tag:'4K', icon:'🎯'},{h:1440,label:'QHD 1440p',tag:'QHD',icon:'🎬'},
  {h:1080,label:'1080p',    tag:'FHD',icon:'🎬'},{h:720, label:'720p',     tag:'HD', icon:'📹'},
  {h:480, label:'480p',     tag:'SD', icon:'📺'},{h:360, label:'360p',     tag:'SD', icon:'📺'},
  {h:240, label:'240p',     tag:'LOW',icon:'📱'},{h:144, label:'144p',     tag:'LOW',icon:'📱'},
];

function buildFormats(info, url) {
  const raw=info.formats||[], isYT=/youtube\.com|youtu\.be/i.test(url), isTT=/tiktok\.com/i.test(url);
  const maxH=raw.reduce((m,f)=>f.height&&f.height>m?f.height:m,0);
  const formats=[];
  for (const q of VIDEO_LADDER) {
    const available=maxH>=q.h*0.65;
    if (!available&&!isYT) continue;
    const match=raw.filter(f=>f.vcodec&&f.vcodec!=='none'&&f.height&&f.height<=q.h).sort((a,b)=>(b.height||0)-(a.height||0))[0];
    formats.push({id:`mp4-${q.h}`,label:`${q.label} (.mp4)`,type:'video',ext:'mp4',quality:q.label,
      size:match?fmtSize(match.filesize||match.filesize_approx):null,
      format_id:`bestvideo[height<=${q.h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q.h}]+bestaudio/best[height<=${q.h}]`,
      tag:q.tag,icon:q.icon,available});
  }
  if (isTT) formats.unshift({id:'nowm',label:'No Watermark (.mp4)',type:'video',ext:'mp4',quality:'Original',size:null,format_id:'download_addr-0/bestvideo[ext=mp4]/best',tag:'✨',icon:'✨',available:true});
  const aRaw=raw.filter(f=>f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0));
  formats.push({id:'mp3-320',label:'MP3 320kbps (.mp3)',type:'audio',ext:'mp3',quality:'320kbps',size:aRaw[0]?fmtSize(aRaw[0].filesize):null,format_id:'bestaudio/best',tag:'MP3',icon:'🎵',available:true});
  formats.push({id:'mp3-128',label:'MP3 128kbps (.mp3)',type:'audio',ext:'mp3',quality:'128kbps',size:null,format_id:'worstaudio[acodec!=none]/worst',tag:'MP3',icon:'🎵',available:true});
  return formats;
}

router.get('/status', async (_req, res) => {
  let ok=false,ver=null;
  try { const yt=await ensureYtdlp(); const r=await execFileAsync(yt,['--version'],{timeout:6000}); ok=true; ver=r.stdout.trim(); } catch(e){console.log('[status]',e.message.slice(0,80));}
  res.json({status:'ok',version:'1.0.0',ytdlp:ok,ytdlpVersion:ver,ytdlpPath:YTDLP,platforms:['YouTube','TikTok','Instagram','Facebook','Twitter/X','Reddit','Vimeo','1000+ more']});
});

router.post('/info', async (req, res) => {
  let url=req.body?.url; if(!url) return res.status(400).json({error:'URL required.'});
  url=url.trim();
  try { const p=new URL(url); if(!['http:','https:'].includes(p.protocol)) throw new Error(); } catch { return res.status(400).json({error:'Invalid URL.'}); }
  const BLOCKED=['netflix.com','spotify.com','disneyplus.com','hulu.com','primevideo.com'];
  if (BLOCKED.some(d=>new URL(url).hostname.includes(d))) return res.status(400).json({error:'DRM-protected — cannot download.'});
  try {
    const yt=await ensureYtdlp();
    console.log('[info]',url.slice(0,80));
    const r=await execFileAsync(yt,['--dump-json','--no-playlist','--no-warnings','--skip-download','--geo-bypass','--no-check-certificates','--user-agent',UA,'--add-header','Accept-Language:en-US,en;q=0.9',url],{timeout:TIMEOUT,maxBuffer:12*1024*1024});
    const info=JSON.parse(r.stdout), ytId=getYTId(url);
    return res.json({success:true,url,platform:detectPlatform(url),media:{
      title:info.title||'Untitled',
      thumbnail:ytId?`https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`:(info.thumbnail||null),
      thumbnailFallback:ytId?`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`:null,
      duration:fmtDur(info.duration),uploader:info.uploader||info.channel||null,
      viewCount:info.view_count?Number(info.view_count).toLocaleString():null,
      formats:buildFormats(info,url)
    }});
  } catch(err) { console.error('[info err]',err.message?.slice(0,200)); return res.status(422).json({error:friendlyError(err.message)}); }
});

router.post('/download', async (req, res) => {
  const {url,formatId,type,ext}=req.body||{}; if(!url||!formatId) return res.status(400).json({error:'url and formatId required.'});
  let fmtArg;
  if (formatId.startsWith('mp4-')) { const h=parseInt(formatId.replace('mp4-','')); fmtArg=`bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`; }
  else if (formatId==='mp3-320') fmtArg='bestaudio/best';
  else if (formatId==='mp3-128') fmtArg='worstaudio[acodec!=none]/worst';
  else if (formatId==='nowm')    fmtArg='download_addr-0/bestvideo[ext=mp4]/best';
  else fmtArg=formatId;
  try {
    const yt=await ensureYtdlp();
    console.log('[download]',formatId,url.slice(0,60));
    const r=await execFileAsync(yt,['--get-url','--no-playlist','--no-warnings','--geo-bypass','--no-check-certificates','-f',fmtArg,'--user-agent',UA,url.trim()],{timeout:TIMEOUT,maxBuffer:5*1024*1024});
    const directUrl=r.stdout.trim().split('\n')[0];
    if (!directUrl) return res.status(500).json({error:'Could not get download URL.'});
    return res.json({success:true,downloadUrl:directUrl,formatId,type:type||'video',ext:ext||'mp4'});
  } catch(err) { console.error('[dl err]',err.message?.slice(0,150)); return res.status(500).json({error:friendlyError(err.message)}); }
});

router.get('/proxy-download', async (req, res) => {
  const {url,filename,ext}=req.query; if(!url) return res.status(400).json({error:'url required'});
  let decoded; try { decoded=decodeURIComponent(url); new URL(decoded); } catch { return res.status(400).json({error:'Invalid URL'}); }
  try {
    const fetch=(await import('node-fetch')).default;
    const ups=await fetch(decoded,{headers:{'User-Agent':UA,'Accept':'*/*','Range':req.headers.range||'bytes=0-','Referer':'https://www.youtube.com/'},redirect:'follow'});
    if (!ups.ok&&ups.status!==206) return res.status(ups.status).json({error:'Upstream '+ups.status});
    const safe=((filename||'ps-download').replace(/[^\w\s.-]/g,'_')).slice(0,100);
    const fext=(ext||'mp4').replace(/[^\w]/g,'');
    res.setHeader('Content-Disposition',`attachment; filename="${safe}.${fext}"`);
    res.setHeader('Content-Type',ups.headers.get('content-type')||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    const cl=ups.headers.get('content-length'); if(cl) res.setHeader('Content-Length',cl);
    if (ups.status===206) res.status(206);
    ups.body.pipe(res);
  } catch(err) { if(!res.headersSent) res.status(500).json({error:'Proxy failed.'}); }
});

module.exports = router;
