#!/usr/bin/env node
// PS Downloader — yt-dlp setup (safe, never crashes build)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function tryExec(cmd) {
  try { return execSync(cmd, { timeout: 10000, stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
}

const ver = tryExec('yt-dlp --version');
if (ver) {
  console.log('[ps-dl] yt-dlp ready:', ver);
} else {
  console.log('[ps-dl] yt-dlp not found on PATH — will use local bin at runtime');
}
// Never throw — build must succeed regardless
