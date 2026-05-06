/**
 * server.js
 * PS Downloader - Main Express Server
 * Heroku-ready, production-grade
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// ─── TRUST PROXY (Heroku) ────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── SECURITY HEADERS ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? [process.env.ALLOWED_ORIGIN]
  : ['http://localhost:3000', 'http://localhost:5500'];

app.use(cors({
  origin: IS_PROD
    ? (origin, cb) => {
        // In production, allow Heroku app domain
        if (!origin || origin.includes('.herokuapp.com') ||
            (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN)) {
          cb(null, true);
        } else {
          cb(null, true); // Allow all in prod for simplicity - tighten as needed
        }
      }
    : true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,  // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a moment before trying again.',
    retryAfter: 60
  },
  skip: (req) => req.path === '/api/status' // Don't rate-limit health checks
});

app.use('/api', limiter);

// ─── REQUEST LOGGING ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!IS_PROD || req.path.startsWith('/api')) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.path} - IP: ${req.ip}`);
  }
  next();
});

// ─── STATIC FILES ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '7d' : 0,
  etag: true
}));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ─── CATCH-ALL → SPA ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(err.status || 500).json({
    error: IS_PROD ? 'Internal server error' : (err.message || 'Unknown error')
  });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ██████╗ ███████╗    ██████╗  ██╗  ██╗');
  console.log('  ██╔══██╗██╔════╝    ██╔══██╗ ██║  ██║');
  console.log('  ██████╔╝███████╗    ██║  ██║ ███████║');
  console.log('  ██╔═══╝ ╚════██║    ██║  ██║ ██╔══██║');
  console.log('  ██║     ███████║    ██████╔╝ ██║  ██║');
  console.log('  ╚═╝     ╚══════╝    ╚═════╝  ╚═╝  ╚═╝');
  console.log('');
  console.log(`  🚀 PS Downloader running on port ${PORT}`);
  console.log(`  🌍 Environment: ${NODE_ENV}`);
  console.log(`  📡 API: http://localhost:${PORT}/api/status`);
  console.log('');
});

module.exports = app;
