/**
 * middleware/logger.js
 * Request logger with colorized output
 */

const IS_PROD = process.env.NODE_ENV === 'production';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function colorStatus(code) {
  if (code >= 500) return COLORS.red;
  if (code >= 400) return COLORS.yellow;
  if (code >= 300) return COLORS.cyan;
  return COLORS.green;
}

function pad(str, len) {
  return String(str).padEnd(len);
}

function logger(req, res, next) {
  const start = Date.now();
  const { method, path: urlPath, ip } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const statusColor = colorStatus(status);
    const c = COLORS;

    // Skip static asset logs in production
    if (IS_PROD && urlPath.match(/\.(js|css|png|ico|woff|svg)$/)) return;

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    console.log(
      `${c.gray}${timestamp}${c.reset} ` +
      `${c.magenta}${pad(method, 6)}${c.reset}` +
      `${c.white}${pad(urlPath, 30)}${c.reset} ` +
      `${statusColor}${status}${c.reset} ` +
      `${c.gray}${ms}ms${c.reset} ` +
      `${c.dim}← ${ip}${c.reset}`
    );
  });

  next();
}

module.exports = logger;
