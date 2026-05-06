/**
 * middleware/validateUrl.js
 * Validates and sanitizes incoming URLs before they reach the API
 */

// Blocked domains — known problematic or non-video sites
const BLOCKED_DOMAINS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.', '10.', '172.16.', '192.168.', // private IPs
];

// Domains that require special handling / known to block
const RESTRICTED_DOMAINS = [
  'netflix.com', 'hulu.com', 'disneyplus.com', 'amazon.com/video',
  'primevideo.com', 'hbomax.com', 'max.com', 'peacocktv.com',
  'paramountplus.com', 'spotify.com',
];

function validateUrl(req, res, next) {
  if (req.method !== 'POST') return next();
  if (!req.path.includes('/info') && !req.path.includes('/download')) return next();

  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required and must be a string.' });
  }

  const trimmed = url.trim();

  // Length check
  if (trimmed.length < 10) {
    return res.status(400).json({ error: 'URL is too short to be valid.' });
  }
  if (trimmed.length > 2048) {
    return res.status(400).json({ error: 'URL is too long.' });
  }

  // Protocol check
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Please include https://' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http:// and https:// URLs are supported.' });
  }

  // Block private/local IPs
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_DOMAINS.some(d => hostname.includes(d))) {
    return res.status(400).json({ error: 'This URL is not allowed.' });
  }

  // Warn on restricted streaming platforms
  if (RESTRICTED_DOMAINS.some(d => hostname.includes(d))) {
    return res.status(400).json({
      error: 'This platform uses DRM protection and cannot be downloaded.',
      detail: 'Streaming services like Netflix, Spotify, Disney+ use encryption that prevents downloading.'
    });
  }

  // Sanitize URL - remove tracking params but keep video ID params
  const KEEP_PARAMS = new Set(['v', 'id', 'video_id', 'watch', 'p', 'clip', 'list']);
  const cleanUrl = trimmed; // Keep original URL for yt-dlp — it handles sanitization

  // Attach cleaned URL to body
  req.body.url = cleanUrl;
  req.body._hostname = hostname;

  next();
}

module.exports = validateUrl;
