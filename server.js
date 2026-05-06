'use strict';
require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
const PROD   = process.env.NODE_ENV === 'production';

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
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a moment.' },
  skip: req => req.path === '/status'
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1d' : 0 }));
app.use('/api', require('./routes/api'));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[ERR]', err.message);
  res.status(500).json({ error: PROD ? 'Server error' : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🔴 PS Downloader running on port ' + PORT);
});
