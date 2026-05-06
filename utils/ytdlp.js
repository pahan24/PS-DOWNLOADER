/**
 * utils/ytdlp.js
 * yt-dlp wrapper — supports 1080p/720p/480p/360p/240p/144p MP4 + MP3
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

function getYtdlpPath() {
  const local = path.join(__dirname, '..', 'bin', 'yt-dlp');
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(local + '.exe')) return local + '.exe';
  return 'yt-dlp';
}

const YTDLP = getYtdlpPath();
const TIMEOUT = 35000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';

async function getInfo(url) {
  const args = [
    '--dump-json', '--no-playlist', '--no-warnings',
    '--skip-download', '--geo-bypass', '--no-check-certificates',
    '--user-agent', UA,
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    url
  ];
  const r = await execFileAsync(YTDLP, args, { timeout: TIMEOUT, maxBuffer: 12 * 1024 * 1024 });
  return JSON.parse(r.stdout);
}

const fmtSize = (b) => {
  if (!b) return null;
  if (b < 1048576) return (b/1024).toFixed(0)+' KB';
  return (b/1048576).toFixed(1)+' MB';
};

const fmtDur = (s) => {
  if (!s) return null;
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
};

// All target resolutions with their display info
const VIDEO_QUALITIES = [
  { height: 2160, label: '4K 2160p',   tag: '4K',   icon: '🎯', formatArg: 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]' },
  { height: 1440, label: 'QHD 1440p',  tag: 'QHD',  icon: '🎬', formatArg: 'bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1440]+bestaudio/best[height<=1440]' },
  { height: 1080, label: '1080p',      tag: 'FHD',  icon: '🎬', formatArg: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]' },
  { height: 720,  label: '720p',       tag: 'HD',   icon: '📹', formatArg: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]' },
  { height: 480,  label: '480p',       tag: 'SD',   icon: '📺', formatArg: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]' },
  { height: 360,  label: '360p',       tag: 'SD',   icon: '📺', formatArg: 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]' },
  { height: 240,  label: '240p',       tag: 'LOW',  icon: '📱', formatArg: 'bestvideo[height<=240][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=240]+bestaudio/best[height<=240]' },
  { height: 144,  label: '144p',       tag: 'LOW',  icon: '📱', formatArg: 'bestvideo[height<=144][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=144]+bestaudio/best[height<=144]' },
];

function parseFormats(info) {
  const rawFmts = info.formats || [];
  const formats = [];

  // Find max available height
  const maxHeight = Math.max(0, ...rawFmts.filter(f => f.height).map(f => f.height));

  // Build video format list
  for (const q of VIDEO_QUALITIES) {
    // Only include if the source has at least some video at this resolution range
    const available = rawFmts.some(f =>
      f.vcodec && f.vcodec !== 'none' &&
      f.height && f.height >= q.height * 0.7 // within 30% tolerance
    );

    // Always include 1080p down to 144p for YouTube; for others check availability
    const isYT = (info.extractor_key || '').toLowerCase().includes('youtube');
    const includeAlways = q.height <= 1080 && isYT;

    if (!available && !includeAlways) continue;
    if (maxHeight < q.height * 0.5 && !includeAlways) continue; // source too low

    // Find a matching raw format for size estimation
    const match = rawFmts
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.height <= q.height && f.height >= q.height * 0.6)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

    formats.push({
      id: `mp4-${q.height}`,
      label: `${q.label} (.mp4)`,
      type: 'video',
      ext: 'mp4',
      quality: q.label,
      size: match ? fmtSize(match.filesize || match.filesize_approx) : null,
      format_id: q.formatArg,
      tag: q.tag,
      icon: q.icon
    });
  }

  // Audio formats
  const audioFmts = rawFmts.filter(f =>
    f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && f.abr
  ).sort((a, b) => (b.abr || 0) - (a.abr || 0));

  if (audioFmts.length > 0 || info.acodec) {
    formats.push({
      id: 'mp3-320',
      label: 'MP3 Audio 320kbps',
      type: 'audio',
      ext: 'mp3',
      quality: '320kbps',
      size: audioFmts[0] ? fmtSize(audioFmts[0].filesize) : null,
      format_id: 'bestaudio/best',
      tag: 'MP3',
      icon: '🎵'
    });
    formats.push({
      id: 'mp3-128',
      label: 'MP3 Audio 128kbps',
      type: 'audio',
      ext: 'mp3',
      quality: '128kbps',
      size: null,
      format_id: 'worstaudio[acodec!=none]/worst',
      tag: 'MP3',
      icon: '🎵'
    });
  }

  // TikTok no-watermark
  const isTikTok = (info.extractor_key || '').toLowerCase().includes('tiktok') ||
    (info.webpage_url || '').includes('tiktok.com');
  if (isTikTok) {
    formats.unshift({
      id: 'nowm',
      label: 'No Watermark (.mp4)',
      type: 'video',
      ext: 'mp4',
      quality: 'Original',
      size: null,
      format_id: 'download_addr-0/bestvideo[ext=mp4]/best',
      tag: '✨',
      icon: '✨'
    });
  }

  return {
    title: info.title || 'Untitled',
    thumbnail: info.thumbnail || null,
    duration: fmtDur(info.duration),
    uploader: info.uploader || info.channel || null,
    viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
    platform: info.extractor_key || 'Unknown',
    formats: formats.filter(f => f) // remove nulls
  };
}

async function getDirectUrl(url, formatId) {
  // formatId is either our id (mp4-1080) or already a yt-dlp format string
  let fmtArg;

  if (formatId.startsWith('mp4-')) {
    const h = parseInt(formatId.replace('mp4-', ''));
    const q = VIDEO_QUALITIES.find(q => q.height === h);
    fmtArg = q ? q.formatArg : `bestvideo[height<=${h}][ext=mp4]+bestaudio/best[height<=${h}]`;
  } else if (formatId === 'mp3-320' || formatId === 'bestaudio') {
    fmtArg = 'bestaudio/best';
  } else if (formatId === 'mp3-128') {
    fmtArg = 'worstaudio[acodec!=none]/worst';
  } else if (formatId === 'nowm') {
    fmtArg = 'download_addr-0/bestvideo[ext=mp4]/best';
  } else {
    fmtArg = formatId; // pass through raw yt-dlp format string
  }

  const args = [
    '--get-url', '--no-playlist', '--no-warnings',
    '--geo-bypass', '--no-check-certificates',
    '-f', fmtArg,
    '--user-agent', UA,
    url
  ];

  const r = await execFileAsync(YTDLP, args, { timeout: TIMEOUT, maxBuffer: 5*1024*1024 });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  return lines[0];
}

async function checkAvailable() {
  try {
    const r = await execFileAsync(YTDLP, ['--version'], { timeout: 5000 });
    return { available: true, version: r.stdout.trim() };
  } catch {
    return { available: false, version: null };
  }
}

module.exports = { getInfo, parseFormats, getDirectUrl, checkAvailable, YTDLP };
