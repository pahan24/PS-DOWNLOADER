/**
 * utils/youtubeHandler.js
 * YouTube-specific format parser — full MP4 resolution ladder
 */

const { getYouTubeId } = require('./platformDetector');

const getThumb = (id) => id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
const getThumbFallback = (id) => id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;

const fmtSize = (b) => {
  if (!b) return null;
  if (b < 1048576) return (b/1024).toFixed(0)+' KB';
  return (b/1048576).toFixed(1)+' MB';
};
const fmtDur = (s) => {
  if (!s) return null;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60);
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
};

// Complete resolution ladder — always show all for YouTube
const RESOLUTIONS = [
  { h: 2160, label: '4K 2160p (.mp4)',  tag: '4K',  icon: '🎯' },
  { h: 1440, label: 'QHD 1440p (.mp4)', tag: 'QHD', icon: '🎬' },
  { h: 1080, label: '1080p (.mp4)',      tag: 'FHD', icon: '🎬' },
  { h: 720,  label: '720p (.mp4)',       tag: 'HD',  icon: '📹' },
  { h: 480,  label: '480p (.mp4)',       tag: 'SD',  icon: '📺' },
  { h: 360,  label: '360p (.mp4)',       tag: 'SD',  icon: '📺' },
  { h: 240,  label: '240p (.mp4)',       tag: 'LOW', icon: '📱' },
  { h: 144,  label: '144p (.mp4)',       tag: 'LOW', icon: '📱' },
];

function parseYouTubeFormats(info) {
  const rawFmts = info.formats || [];
  const maxH = Math.max(0, ...rawFmts.filter(f => f.height).map(f => f.height));
  const formats = [];

  for (const q of RESOLUTIONS) {
    // Find best matching raw format for size estimate
    const match = rawFmts
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.height <= q.h)
      .sort((a,b) => (b.height||0)-(a.height||0))[0];

    formats.push({
      id: `mp4-${q.h}`,
      label: q.label,
      type: 'video',
      ext: 'mp4',
      quality: q.label.split(' (.')[0],
      size: match ? fmtSize(match.filesize || match.filesize_approx) : null,
      format_id: `bestvideo[height<=${q.h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q.h}]+bestaudio/best[height<=${q.h}]`,
      tag: q.tag,
      icon: q.icon,
      available: maxH >= q.h * 0.6
    });
  }

  // MP3 Audio options
  const audioFmts = rawFmts
    .filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
    .sort((a,b) => (b.abr||0)-(a.abr||0));

  formats.push({
    id: 'mp3-320', label: 'MP3 320kbps (.mp3)',
    type: 'audio', ext: 'mp3', quality: '320kbps',
    size: audioFmts[0] ? fmtSize(audioFmts[0].filesize) : null,
    format_id: 'bestaudio/best', tag: 'MP3', icon: '🎵', available: true
  });
  formats.push({
    id: 'mp3-128', label: 'MP3 128kbps (.mp3)',
    type: 'audio', ext: 'mp3', quality: '128kbps',
    size: null,
    format_id: 'worstaudio[acodec!=none]/worst', tag: 'MP3', icon: '🎵', available: true
  });

  const videoId = getYouTubeId(info.webpage_url || info.original_url || '');

  return {
    title: info.title || 'Untitled',
    thumbnail: getThumb(videoId) || info.thumbnail,
    thumbnailFallback: getThumbFallback(videoId),
    duration: fmtDur(info.duration),
    uploader: info.uploader || info.channel || null,
    viewCount: info.view_count ? Number(info.view_count).toLocaleString() : null,
    uploadDate: info.upload_date
      ? `${info.upload_date.slice(0,4)}-${info.upload_date.slice(4,6)}-${info.upload_date.slice(6,8)}`
      : null,
    isLive: info.is_live || false,
    platform: 'YouTube',
    formats
  };
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

module.exports = { parseYouTubeFormats, isYouTubeUrl, getThumb, getThumbFallback };
