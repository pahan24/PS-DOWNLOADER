#!/usr/bin/env node
/**
 * setup-ytdlp.js
 * On Heroku: yt-dlp installed by Python buildpack via requirements.txt
 * On local: downloads binary to ./bin/yt-dlp
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const YTDLP_BIN = path.join(BIN_DIR, 'yt-dlp');

function tryExec(cmd) {
  try {
    const out = execSync(cmd, { timeout: 8000, stdio: 'pipe' }).toString().trim();
    return out;
  } catch { return null; }
}

function downloadBinary(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, { timeout: 60000 }, (r) => {
      if (r.statusCode === 301 || r.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return downloadBinary(r.headers.location, dest, hops + 1).then(resolve).catch(reject);
      }
      if (r.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${r.statusCode}`));
      }
      r.pipe(file);
      file.on('finish', () => file.close(() => {
        try { fs.chmodSync(dest, '755'); } catch {}
        resolve();
      }));
      file.on('error', e => { try { fs.unlinkSync(dest); } catch {} reject(e); });
    }).on('error', e => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

async function main() {
  console.log('[ps-dl] Checking yt-dlp availability...');

  // 1. Check system PATH (Heroku Python buildpack installs here)
  const sysVer = tryExec('yt-dlp --version');
  if (sysVer) {
    console.log(`[ps-dl] ✅ System yt-dlp found: v${sysVer}`);
    return;
  }

  // 2. Check local bin/
  if (fs.existsSync(YTDLP_BIN)) {
    const localVer = tryExec(`"${YTDLP_BIN}" --version`);
    if (localVer) {
      console.log(`[ps-dl] ✅ Local yt-dlp found: v${localVer}`);
      return;
    }
    // corrupt binary — remove it
    try { fs.unlinkSync(YTDLP_BIN); } catch {}
  }

  // 3. pip install fallback
  console.log('[ps-dl] Trying pip install yt-dlp...');
  const pipResult = tryExec('pip3 install -q yt-dlp 2>&1 || pip install -q yt-dlp 2>&1');
  const afterPip = tryExec('yt-dlp --version');
  if (afterPip) {
    console.log(`[ps-dl] ✅ pip yt-dlp installed: v${afterPip}`);
    return;
  }

  // 4. Download binary directly (local dev only)
  const platform = process.platform;
  const urls = {
    linux:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    win32:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  };
  const dlUrl = urls[platform];
  if (!dlUrl) {
    console.warn('[ps-dl] ⚠️  Unknown platform — install yt-dlp manually');
    return;
  }

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[ps-dl] Downloading yt-dlp binary for ${platform}...`);
  try {
    await downloadBinary(dlUrl, YTDLP_BIN);
    const ver = tryExec(`"${YTDLP_BIN}" --version`);
    console.log(`[ps-dl] ✅ yt-dlp binary ready: v${ver || 'unknown'}`);
  } catch (e) {
    console.warn('[ps-dl] ⚠️  Binary download failed:', e.message);
    console.warn('[ps-dl]    Install manually: pip install yt-dlp');
  }
}

main().catch(e => { console.warn('[ps-dl] setup error:', e.message); });
