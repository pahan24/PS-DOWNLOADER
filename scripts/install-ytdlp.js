#!/usr/bin/env node
/**
 * install-ytdlp.js
 * Downloads yt-dlp binary into ./bin/ at build time (postinstall).
 * Works on Heroku (linux), macOS, Windows.
 * NEVER throws — build must always succeed.
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const BIN_DIR  = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'yt-dlp');

// Already installed? Quick version check
function alreadyInstalled() {
  try {
    if (!fs.existsSync(BIN_PATH)) return false;
    execSync(`"${BIN_PATH}" --version`, { timeout: 6000, stdio: 'pipe' });
    return true;
  } catch {
    try { fs.unlinkSync(BIN_PATH); } catch {}
    return false;
  }
}

function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 8) return reject(new Error('Too many redirects'));
    var file = fs.createWriteStream(dest);
    var req = https.get(url, { timeout: 120000 }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return download(res.headers.location, dest, redirects + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', function() {
        file.close(function() {
          try { fs.chmodSync(dest, '755'); } catch {}
          resolve();
        });
      });
      file.on('error', function(e) {
        try { fs.unlinkSync(dest); } catch {}
        reject(e);
      });
    });
    req.on('error', function(e) {
      try { fs.unlinkSync(dest); } catch {}
      reject(e);
    });
    req.on('timeout', function() {
      req.destroy();
      try { fs.unlinkSync(dest); } catch {}
      reject(new Error('Download timeout'));
    });
  });
}

async function main() {
  if (alreadyInstalled()) {
    var ver = execSync('"' + BIN_PATH + '" --version', { stdio: 'pipe' }).toString().trim();
    console.log('[yt-dlp] Already installed: v' + ver);
    return;
  }

  var platform = process.platform;
  var urls = {
    linux:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    win32:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  };

  var dlUrl = urls[platform];
  if (!dlUrl) {
    console.log('[yt-dlp] Unsupported platform: ' + platform + ' — skipping binary download');
    return;
  }

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  var dest = platform === 'win32' ? BIN_PATH + '.exe' : BIN_PATH;
  console.log('[yt-dlp] Downloading for ' + platform + '...');

  try {
    await download(dlUrl, dest);
    var ver = execSync('"' + dest + '" --version', { stdio: 'pipe' }).toString().trim();
    console.log('[yt-dlp] Installed successfully: v' + ver);
  } catch (e) {
    console.log('[yt-dlp] Download failed: ' + e.message);
    console.log('[yt-dlp] App will still start — yt-dlp missing at runtime only');
  }
}

main().catch(function(e) {
  console.log('[yt-dlp] Setup error (non-fatal): ' + e.message);
});
