// setup.js - downloads yt-dlp binary safely (never crashes npm install)
var https = require('https');
var fs    = require('fs');
var path  = require('path');
var { execSync } = require('child_process');

var BIN = path.join(__dirname, 'bin', 'yt-dlp');

function log(msg) { console.log('[setup] ' + msg); }

function check(cmd) {
  try { execSync(cmd, { timeout: 8000, stdio: 'pipe' }); return true; }
  catch (e) { return false; }
}

function download(url, dest, hops, done) {
  hops = hops || 0;
  if (hops > 8) return done(new Error('Too many redirects'));
  var tmp = dest + '.tmp';
  var file = fs.createWriteStream(tmp);
  var req = https.get(url, { timeout: 120000 }, function(res) {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      try { fs.unlinkSync(tmp); } catch(e) {}
      return download(res.headers.location, dest, hops + 1, done);
    }
    if (res.statusCode !== 200) {
      file.close();
      try { fs.unlinkSync(tmp); } catch(e) {}
      return done(new Error('HTTP ' + res.statusCode));
    }
    res.pipe(file);
    file.on('finish', function() {
      file.close(function() {
        try {
          fs.renameSync(tmp, dest);
          fs.chmodSync(dest, '755');
          done(null);
        } catch(e) { done(e); }
      });
    });
    file.on('error', function(e) {
      try { fs.unlinkSync(tmp); } catch(ex) {}
      done(e);
    });
  });
  req.on('error', function(e) {
    try { fs.unlinkSync(tmp); } catch(ex) {}
    done(e);
  });
  req.on('timeout', function() {
    req.destroy();
    done(new Error('Download timed out'));
  });
}

function run() {
  // 1. Already have local binary?
  if (fs.existsSync(BIN) && check('"' + BIN + '" --version')) {
    log('yt-dlp already installed at ' + BIN);
    return;
  }

  // 2. System yt-dlp?
  if (check('yt-dlp --version')) {
    log('System yt-dlp found');
    return;
  }

  // 3. Download binary
  log('Downloading yt-dlp binary for linux...');
  var dir = path.dirname(BIN);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  var URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

  download(URL, BIN, 0, function(err) {
    if (err) {
      log('Download failed: ' + err.message);
      log('yt-dlp will be unavailable - app will still start');
    } else {
      if (check('"' + BIN + '" --version')) {
        log('yt-dlp installed successfully!');
      } else {
        log('Binary downloaded but not executable');
      }
    }
  });
}

try { run(); }
catch(e) { console.log('[setup] Non-fatal error: ' + e.message); }
