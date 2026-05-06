/**
 * platformDetector.js
 * Detects platform from URL and returns metadata
 */

const PLATFORMS = {
  youtube: {
    name: 'YouTube',
    patterns: [
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /youtube\.com\/live\/([A-Za-z0-9_-]{11})/
    ],
    color: '#ff0000',
    icon: 'youtube'
  },
  tiktok: {
    name: 'TikTok',
    patterns: [
      /tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
      /vm\.tiktok\.com\/([A-Za-z0-9]+)/,
      /vt\.tiktok\.com\/([A-Za-z0-9]+)/
    ],
    color: '#69c9d0',
    icon: 'tiktok'
  },
  instagram: {
    name: 'Instagram',
    patterns: [
      /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/stories\/[\w.]+\/(\d+)/
    ],
    color: '#e1306c',
    icon: 'instagram'
  },
  facebook: {
    name: 'Facebook',
    patterns: [
      /facebook\.com\/(?:watch\/?\?v=|video\.php\?v=)(\d+)/,
      /facebook\.com\/[\w.]+\/videos\/(\d+)/,
      /fb\.watch\/([A-Za-z0-9]+)/,
      /facebook\.com\/reel\/(\d+)/
    ],
    color: '#1877f2',
    icon: 'facebook'
  },
  twitter: {
    name: 'Twitter / X',
    patterns: [
      /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/
    ],
    color: '#1da1f2',
    icon: 'twitter'
  },
  reddit: {
    name: 'Reddit',
    patterns: [
      /reddit\.com\/r\/\w+\/comments\/([A-Za-z0-9]+)/,
      /v\.redd\.it\/([A-Za-z0-9]+)/
    ],
    color: '#ff4500',
    icon: 'reddit'
  },
  dailymotion: {
    name: 'Dailymotion',
    patterns: [
      /dailymotion\.com\/video\/([A-Za-z0-9]+)/,
      /dai\.ly\/([A-Za-z0-9]+)/
    ],
    color: '#0066dc',
    icon: 'generic'
  },
  vimeo: {
    name: 'Vimeo',
    patterns: [
      /vimeo\.com\/(\d+)/
    ],
    color: '#1ab7ea',
    icon: 'generic'
  }
};

/**
 * Detect platform from URL
 * @param {string} url
 * @returns {{ platform: string, name: string, videoId: string|null, color: string, icon: string } | null}
 */
function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    new URL(url); // validate URL
  } catch {
    return null;
  }

  for (const [platform, config] of Object.entries(PLATFORMS)) {
    for (const pattern of config.patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          platform,
          name: config.name,
          videoId: match[1] || null,
          color: config.color,
          icon: config.icon
        };
      }
    }
  }

  // Generic URL - check if it could be a direct media file
  const mediaExtensions = /\.(mp4|webm|mkv|avi|mov|flv|m3u8|mp3|m4a|aac|opus|ogg|wav)(\?|$)/i;
  if (mediaExtensions.test(url)) {
    return {
      platform: 'direct',
      name: 'Direct Media',
      videoId: null,
      color: '#888',
      icon: 'generic'
    };
  }

  return {
    platform: 'generic',
    name: 'Web Media',
    videoId: null,
    color: '#888',
    icon: 'generic'
  };
}

/**
 * Check if URL is supported
 */
function isSupported(url) {
  const result = detectPlatform(url);
  return result !== null;
}

/**
 * Get YouTube video ID from URL
 */
function getYouTubeId(url) {
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

module.exports = { detectPlatform, isSupported, getYouTubeId, PLATFORMS };
