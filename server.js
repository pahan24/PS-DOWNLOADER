'use strict';
require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app     = express();
const PORT    = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "https:", "blob:"],
      mediaSrc:   ["'self'", "https:", "blob:"],
      connectSrc: ["'self'", "https:"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: true, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use('/api', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS)    || 60000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please wait a moment.' },
  skip: (req) => req.path === '/status'
}));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(new Date().toISOString(), req.method, req.path);
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0
}));

// API routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: IS_PROD ? 'Server error' : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🔴 PS DOWNLOADER');
  console.log('  PORT:', PORT);
  console.log('  ENV: ', process.env.NODE_ENV || 'development');
  console.log('  API:  http://localhost:' + PORT + '/api/status');
  console.log('');
});

module.exports = app;
