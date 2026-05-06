#!/usr/bin/env node
/**
 * setup-ytdlp.js — Smart yt-dlp installer
 * Works on local dev, Heroku, Railway, Render
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const YTDLP_BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

function check(cmd) {
  try { execSync(cmd, { timeout: 6000, stdio: 'pipe' }); return true; } catch { return false; }
}

function download(url, dest, hops = 0) {
  return new Promise((res, rej) => {
    if (hops > 5) return rej(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, { timeout: 60000 }, (r) => {
      if (r.statusCode === 301 || r.statusCode === 302) {
        file.close(); try { fs.unlinkSync(dest); } catch {}
        return download(r.headers.location, dest, hops + 1).then(res).catch(rej);
      }
      if (r.statusCode !== 200) { file.close(); return rej(new Error(`HTTP ${r.statusCode}`)); }
      r.pipe(file);
      file.on('finish', () => file.close(() => { if (process.platform !== 'win32') fs.chmodSync(dest, '755'); res(); }));
      file.on('error', e => { try { fs.unlinkSync(dest); } catch {} rej(e); });
    }).on('error', e => { try { fs.unlinkSync(dest); } catch {} rej(e); });
  });
}

async function main() {
  console.log('[setup] Checking for yt-dlp...');

  if (check('yt-dlp --version')) { console.log('[setup] ✅ System yt-dlp found'); return; }
  if (fs.existsSync(YTDLP_BIN) && check(`"${YTDLP_BIN}" --version`)) { console.log('[setup] ✅ Local yt-dlp found'); return; }

  try { execSync('pip3 install -q yt-dlp || pip install -q yt-dlp', { timeout: 90000, stdio: 'inherit' }); if (check('yt-dlp --version')) return; } catch {}

  const urls = {
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    win32:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  };
  const dlUrl = urls[process.platform];
  if (!dlUrl) { console.warn('[setup] ⚠️  Unknown platform, skipping'); return; }

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
  console.log('[setup] Downloading yt-dlp binary...');
  try { await download(dlUrl, YTDLP_BIN); console.log('[setup] ✅ yt-dlp ready'); }
  catch (e) { console.warn('[setup] ⚠️  Download failed:', e.message, '— install manually'); }
}

main().catch(console.error);
