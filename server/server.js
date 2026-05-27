require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy so IP logging works correctly
app.set('trust proxy', 1);

// Security headers (CSP disabled — internal tool, not public-facing)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — locked to same origin in production; allow localhost for dev
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, sync helper)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Rate limiting for sensitive routes
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Health check — Render uses this to verify the service is up
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/submit', require('./routes/submit'));
app.use('/api/admin', adminLimiter, require('./routes/admin'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/qr', require('./routes/qr'));

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, '../public')));

// SPA fallback — send index.html for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RES Site Reports server running on port ${PORT}`);
});
