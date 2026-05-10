'use strict';
var express  = require('express');
var cors     = require('cors');
var helmet   = require('helmet');
var rl       = require('express-rate-limit');
var path     = require('path');
var fs       = require('fs');
var https    = require('https');
var cp       = require('child_process');

var app  = express();
var PORT = process.env.PORT || 3000;
var UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
var BIN  = path.join(__dirname, 'bin', 'yt-dlp');
var YTDL = null;

/* ── yt-dlp ──────────────────────────────────────────────────────────────── */
function getYT(cb) {
  if (YTDL) return cb(null, YTDL);
  if (fs.existsSync(BIN)) {
    cp.execFile(BIN, ['--version'], {timeout:6000}, function(e) {
      if (!e) { YTDL = BIN; return cb(null, YTDL); }
      try { fs.unlinkSync(BIN); } catch(x) {}
      sysPath(cb);
    });
    return;
  }
  sysPath(cb);
}
function sysPath(cb) {
  cp.exec('yt-dlp --version', {timeout:6000}, function(e) {
    if (!e) { YTDL = 'yt-dlp'; return cb(null, YTDL); }
    dlBin(cb);
  });
}
function dlBin(cb) {
  console.log('[ytdl] downloading...');
  var dir = path.dirname(BIN);
  if (!fs.existsSync(dir)) try { fs.mkdirSync(dir,{recursive:true}); } catch(x){}
  var tmp = BIN+'.tmp';
  function get(u, n) {
    if (n>8) return cb(new Error('redirect loop'));
    var f = fs.createWriteStream(tmp);
    https.get(u, {timeout:120000}, function(res) {
      if (res.statusCode===301||res.statusCode===302) {
        f.close(); try{fs.unlinkSync(tmp);}catch(x){}
        return get(res.headers.location, n+1);
      }
      if (res.statusCode!==200) {
        f.close(); try{fs.unlinkSync(tmp);}catch(x){}
        return cb(new Error('HTTP '+res.statusCode));
      }
      res.pipe(f);
      f.on('finish', function() {
        f.close(function() {
          try{fs.renameSync(tmp,BIN);fs.chmodSync(BIN,'755');}catch(x){}
          YTDL=BIN; console.log('[ytdl] ready'); cb(null,YTDL);
        });
      });
      f.on('error', function(e){try{fs.unlinkSync(tmp);}catch(x){} cb(e);});
    }).on('error', function(e){try{fs.unlinkSync(tmp);}catch(x){} cb(e);});
  }
  get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', 0);
}
function run(args, cb) {
  getYT(function(e,bin) {
    if (e||!bin) return cb(new Error('Media engine not ready. Wait 30s and retry.'));
    cp.execFile(bin, args, {timeout:45000, maxBuffer:20*1024*1024}, cb);
  });
}
getYT(function(e,b){ if(e) console.log('[ytdl] warmup:',e.message); else console.log('[ytdl] ready at',b); });

/* ── helpers ─────────────────────────────────────────────────────────────── */
function sz(b){return !b?null:b<1048576?Math.round(b/1024)+'KB':(b/1048576).toFixed(1)+'MB';}
function dur(s){if(!s)return null;var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60);return h?h+':'+p2(m)+':'+p2(sc):m+':'+p2(sc);}
function p2(n){return String(n).padStart(2,'0');}
function plt(u){if(/youtube\.com|youtu\.be/i.test(u))return 'YouTube';if(/tiktok\.com/i.test(u))return 'TikTok';if(/instagram\.com/i.test(u))return 'Instagram';if(/facebook\.com|fb\.watch/i.test(u))return 'Facebook';if(/twitter\.com|x\.com/i.test(u))return 'Twitter/X';if(/vimeo\.com/i.test(u))return 'Vimeo';return 'Web Media';}
function ytid(u){var m=u.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);return m?m[1]:null;}
function nice(msg){
  if(!msg)return 'Could not fetch media.';
  if(/private/i.test(msg))return 'This video is private.';
  if(/not available|unavailable/i.test(msg))return 'Video unavailable in this region.';
  if(/age|sign in/i.test(msg))return 'Age-restricted content.';
  if(/removed|deleted/i.test(msg))return 'Video has been removed.';
  if(/Unsupported URL/i.test(msg))return 'URL not supported.';
  if(/403/i.test(msg))return 'Access denied by platform.';
  if(/404/i.test(msg))return 'Video not found.';
  if(/timed?\s*out/i.test(msg))return 'Timed out — try again.';
  if(/ENOENT|not found|No such/i.test(msg))return 'Media engine starting — wait 30s and retry.';
  return 'Failed. Check the URL and try again.';
}
var LADDER=[{h:1080,q:'1080p',tag:'FHD',i:'🎬'},{h:720,q:'720p',tag:'HD',i:'📹'},{h:480,q:'480p',tag:'SD',i:'📺'},{h:360,q:'360p',tag:'SD',i:'📺'},{h:240,q:'240p',tag:'LOW',i:'📱'},{h:144,q:'144p',tag:'LOW',i:'📱'}];
function fmts(info,url){
  var raw=info.formats||[],isYT=/youtube\.com|youtu\.be/i.test(url),isTT=/tiktok\.com/i.test(url);
  var maxH=raw.reduce(function(m,f){return f.height&&f.height>m?f.height:m;},0);
  var out=[];
  LADDER.forEach(function(q){
    var av=maxH>=q.h*0.6;
    if(!av&&!isYT)return;
    var m=raw.filter(function(f){return f.vcodec&&f.vcodec!=='none'&&f.height&&f.height<=q.h;}).sort(function(a,b){return(b.height||0)-(a.height||0);})[0];
    out.push({id:'mp4-'+q.h,label:q.q+' (.mp4)',type:'video',ext:'mp4',quality:q.q,size:m?sz(m.filesize||m.filesize_approx):null,fmtArg:'bestvideo[height<='+q.h+'][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<='+q.h+']+bestaudio/best[height<='+q.h+']',tag:q.tag,icon:q.i,available:av});
  });
  if(isTT)out.unshift({id:'nowm',label:'No Watermark (.mp4)',type:'video',ext:'mp4',quality:'Original',size:null,fmtArg:'download_addr-0/bestvideo[ext=mp4]/best',tag:'✨',icon:'✨',available:true});
  var ar=raw.filter(function(f){return f.vcodec==='none'&&f.acodec&&f.acodec!=='none';}).sort(function(a,b){return(b.abr||0)-(a.abr||0);});
  out.push({id:'mp3',label:'MP3 Audio (.mp3)',type:'audio',ext:'mp3',quality:'Best',size:ar[0]?sz(ar[0].filesize):null,fmtArg:'bestaudio/best',tag:'MP3',icon:'🎵',available:true});
  return out;
}

/* ── middleware ──────────────────────────────────────────────────────────── */
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://fonts.gstatic.com"],fontSrc:["'self'","https://fonts.gstatic.com"],imgSrc:["'self'","data:","https:","blob:"],connectSrc:["'self'"],mediaSrc:["'self'","blob:","https:"]}},crossOriginEmbedderPolicy:false}));
app.use(cors()); app.options('/api/info',cors()); app.options('/api/download',cors());
app.use(express.json({limit:'1mb'}));
app.use('/api',rl({windowMs:60000,max:40,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests.'},skip:function(req){return req.path==='/status';}}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h'}));

/* ── routes ──────────────────────────────────────────────────────────────── */
app.get('/api/status',function(req,res){
  getYT(function(e,bin){
    if(e||!bin)return res.json({ok:true,ytdlp:false,version:null,path:'none'});
    cp.execFile(bin,['--version'],{timeout:6000},function(er,out){
      res.json({ok:true,ytdlp:!er,version:er?null:out.trim(),path:bin});
    });
  });
});

app.post('/api/info',function(req,res){
  var url=((req.body||{}).url||'').trim();
  if(!url)return res.status(400).json({error:'URL required.'});
  try{new URL(url);}catch(e){return res.status(400).json({error:'Invalid URL.'});}
  console.log('[info]',url.slice(0,80));
  run(['--dump-json','--no-playlist','--no-warnings','--skip-download','--geo-bypass','--no-check-certificates','--user-agent',UA,'--add-header','Accept-Language:en-US,en;q=0.9',url],function(e,stdout){
    if(e){console.error('[info]',e.message.slice(0,200));return res.status(422).json({error:nice(e.message)});}
    var info;try{info=JSON.parse(stdout);}catch(x){return res.status(500).json({error:'Parse error.'});}
    var id=ytid(url);
    res.json({success:true,platform:plt(url),media:{title:info.title||'Untitled',thumbnail:id?'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg':(info.thumbnail||null),duration:dur(info.duration),uploader:info.uploader||info.channel||null,viewCount:info.view_count?Number(info.view_count).toLocaleString():null,formats:fmts(info,url)}});
  });
});

app.post('/api/download',function(req,res){
  var b=req.body||{},url=b.url,fmtArg=b.fmtArg,ext=b.ext||'mp4';
  if(!url||!fmtArg)return res.status(400).json({error:'url and fmtArg required.'});
  console.log('[dl]',fmtArg.slice(0,40),url.slice(0,50));
  run(['--get-url','--no-playlist','--no-warnings','--geo-bypass','--no-check-certificates','-f',fmtArg,'--user-agent',UA,url],function(e,stdout){
    if(e){console.error('[dl]',e.message.slice(0,150));return res.status(500).json({error:nice(e.message)});}
    var dlUrl=stdout.trim().split('\n')[0];
    if(!dlUrl)return res.status(500).json({error:'No download URL found.'});
    res.json({success:true,url:dlUrl,ext:ext});
  });
});

/* ── SPA — Express 4 compatible wildcard ────────────────────────────────── */
app.use(function(req,res){
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT,'0.0.0.0',function(){
  console.log('PS Downloader running on port '+PORT);
});
