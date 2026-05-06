/**
 * routes/api.js
 * PS Downloader — API Routes
 * YouTube + TikTok + Instagram + Facebook + 1000+ sites
 */

const express = require('express');
const router = express.Router();
const { getInfo, parseFormats, getDirectUrl, checkAvailable } = require('../utils/ytdlp');
const { detectPlatform } = require('../utils/platformDetector');
const { parseYouTubeFormats, isYouTubeUrl } = require('../utils/youtubeHandler');
const validateUrl = require('../middleware/validateUrl');

// Apply URL validation to all POST routes
router.use(validateUrl);

// ── GET /api/status ───────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const ytdlp = await checkAvailable();
  res.json({
    status: 'ok',
    version: '1.0.0',
    ytdlp: ytdlp.available,
    ytdlpVersion: ytdlp.version,
    supportedPlatforms: [
      'YouTube', 'TikTok', 'Instagram', 'Facebook',
      'Twitter/X', 'Reddit', 'Vimeo', 'Dailymotion',
      'SoundCloud', 'Twitch', 'Generic (1000+ sites)'
    ],
    timestamp: new Date().toISOString()
  });
});

// ── POST /api/info ────────────────────────────────────────────────────────────
router.post('/info', async (req, res) => {
  const { url } = req.body;

  const platformInfo = detectPlatform(url);

  try {
    console.log(`[API/info] ${platformInfo?.name || 'Unknown'} — ${url.slice(0, 80)}`);

    const rawInfo = await getInfo(url);

    // Use YouTube-specific parser for richer format options
    let parsed;
    if (isYouTubeUrl(url)) {
      parsed = parseYouTubeFormats(rawInfo);
    } else {
      parsed = parseFormats(rawInfo);
    }

    // Ensure we always have at least one format
    if (!parsed.formats || parsed.formats.length === 0) {
      parsed.formats = [{
        id: 'best',
        label: 'Best Quality',
        type: 'video',
        ext: 'mp4',
        quality: 'Best',
        size: null,
        format_id: 'best',
        tag: 'BEST',
        icon: '🎬'
      }];
    }

    return res.json({
      success: true,
      url,
      platform: platformInfo || { platform: 'generic', name: 'Web Media', color: '#888' },
      media: {
        title: parsed.title,
        thumbnail: parsed.thumbnail,
        thumbnailFallback: parsed.thumbnailFallback || null,
        duration: parsed.duration,
        uploader: parsed.uploader,
        viewCount: parsed.viewCount,
        uploadDate: parsed.uploadDate || null,
        isLive: parsed.isLive || false,
        formats: parsed.formats
      }
    });

  } catch (err) {
    console.error(`[API/info] Error:`, err.message?.slice(0, 200));

    const msg = err.message || '';
    let userError = 'Could not fetch media info. Check the URL and try again.';

    if (msg.includes('Private video') || msg.includes('This video is private'))
      userError = 'This video is private and cannot be downloaded.';
    else if (msg.includes('not available in your country') || msg.includes('geo'))
      userError = 'This video is geo-restricted and not available in this region.';
    else if (msg.includes('age') || msg.includes('confirm your age') || msg.includes('sign in'))
      userError = 'This content requires age verification. Cannot be downloaded.';
    else if (msg.includes('removed') || msg.includes('no longer available') || msg.includes('deleted'))
      userError = 'This video has been removed or is no longer available.';
    else if (msg.includes('Unsupported URL') || msg.includes('Unable to extract'))
      userError = 'This URL is not supported. Try a direct video link.';
    else if (msg.includes('HTTP Error 403'))
      userError = 'Access denied by the platform (403). The content may be restricted.';
    else if (msg.includes('HTTP Error 404'))
      userError = 'Video not found (404). The link may be broken or the video deleted.';
    else if (msg.includes('timed out') || msg.includes('timeout'))
      userError = 'Request timed out. The server is busy — please try again.';
    else if (msg.includes('No such file') || msg.includes('yt-dlp'))
      userError = 'Media engine is initializing. Please wait a moment and try again.';
    else if (msg.includes('members-only') || msg.includes('members only'))
      userError = 'This content is members-only and cannot be downloaded.';
    else if (msg.includes('copyright') || msg.includes('rights'))
      userError = 'This video is unavailable due to copyright restrictions.';

    return res.status(422).json({ error: userError, _debug: msg.slice(0, 100) });
  }
});

// ── POST /api/download ────────────────────────────────────────────────────────
router.post('/download', async (req, res) => {
  const { url, formatId, type, ext } = req.body;

  if (!url || !formatId) {
    return res.status(400).json({ error: 'url and formatId are required.' });
  }

  try {
    console.log(`[API/download] format=${formatId} type=${type} — ${url.slice(0, 70)}`);

    const directUrl = await getDirectUrl(url, formatId);

    if (!directUrl || directUrl.trim() === '') {
      return res.status(500).json({ error: 'Could not retrieve a download URL for this format.' });
    }

    return res.json({
      success: true,
      downloadUrl: directUrl.trim(),
      formatId,
      type: type || 'video',
      ext: ext || 'mp4'
    });

  } catch (err) {
    console.error(`[API/download] Error:`, err.message?.slice(0, 200));
    const msg = err.message || '';
    let userError = 'Failed to get download link.';

    if (msg.includes('timed out')) userError = 'Timed out extracting download link. Try again.';
    else if (msg.includes('403')) userError = 'Platform denied access to this download.';
    else if (msg.includes('Sign in')) userError = 'This format requires sign-in. Try a different format.';

    return res.status(500).json({ error: userError });
  }
});

// ── GET /api/proxy-download ───────────────────────────────────────────────────
// Proxy the media stream through our server so browser triggers download dialog
router.get('/proxy-download', async (req, res) => {
  const { url, filename, ext } = req.query;

  if (!url) return res.status(400).json({ error: 'url query param required' });

  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
    new URL(decodedUrl); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const upstream = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Range': req.headers.range || 'bytes=0-',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com'
      },
      redirect: 'follow'
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[proxy] Upstream error: ${upstream.status}`);
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
    }

    // Forward relevant headers
    const safeFilename = ((filename || 'ps-download').replace(/[^\w\s.-]/g, '_')).slice(0, 100);
    const fileExt = (ext || 'mp4').replace(/[^\w]/g, '');
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');

    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.${fileExt}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (upstream.status === 206) res.status(206);

    upstream.body.pipe(res);

    upstream.body.on('error', (e) => {
      console.error('[proxy] Stream error:', e.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error('[proxy] Fetch error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy download failed.' });
    }
  }
});

// ── GET /api/thumbnail-proxy ──────────────────────────────────────────────────
// Proxy thumbnail images to avoid CORS issues
router.get('/thumbnail-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();

  try {
    const fetch = (await import('node-fetch')).default;
    const imgRes = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!imgRes.ok) return res.status(imgRes.status).end();

    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.body.pipe(res);
  } catch {
    res.status(500).end();
  }
});

module.exports = router;
