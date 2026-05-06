# 🚀 PS DOWNLOADER — Heroku Deployment Guide

Follow these steps **exactly** to get PS Downloader live on Heroku.

---

## ✅ Prerequisites

Install these before starting:

1. **Node.js 18+** → https://nodejs.org
2. **Git** → https://git-scm.com
3. **Heroku CLI** → https://devcenter.heroku.com/articles/heroku-cli
4. **Heroku Account** → https://signup.heroku.com (free)

---

## 📋 Step-by-Step Deployment

### Step 1 — Verify CLI is installed

```bash
heroku --version
# Should print: heroku/x.x.x ...

git --version
# Should print: git version x.x.x
```

---

### Step 2 — Login to Heroku

```bash
heroku login
# Opens browser → click "Log In"
```

---

### Step 3 — Go into project folder

```bash
cd ps-downloader
```

---

### Step 4 — Initialize Git repository

```bash
git init
git add .
git commit -m "🚀 Initial commit — PS Downloader"
```

---

### Step 5 — Create Heroku app

```bash
# Option A: Custom name (must be globally unique)
heroku create ps-downloader-myname

# Option B: Random Heroku name
heroku create
```

After this, Heroku gives you a URL like:
`https://ps-downloader-myname.herokuapp.com`

---

### Step 6 — Set buildpacks (IMPORTANT)

yt-dlp needs both Node.js AND Python:

```bash
heroku buildpacks:clear
heroku buildpacks:add heroku/nodejs
heroku buildpacks:add heroku/python
```

Verify:
```bash
heroku buildpacks
# Should show:
# 1. heroku/nodejs
# 2. heroku/python
```

---

### Step 7 — Set environment variables

```bash
heroku config:set NODE_ENV=production
heroku config:set RATE_LIMIT_MAX_REQUESTS=30
heroku config:set RATE_LIMIT_WINDOW_MS=60000
```

---

### Step 8 — Deploy!

```bash
git push heroku main

# If your branch is named "master" instead of "main":
git push heroku master
```

Watch the build logs. You'll see:
- Node.js dependencies installing
- Python/yt-dlp installing
- App starting

---

### Step 9 — Open your app

```bash
heroku open
```

Your PS Downloader is now live! 🎉

---

### Step 10 — Test the API

```bash
# Replace YOUR-APP with your Heroku app name
curl https://YOUR-APP.herokuapp.com/api/status
```

Expected response:
```json
{
  "status": "ok",
  "ytdlp": true,
  "ytdlpVersion": "2024.xx.xx",
  ...
}
```

---

## 🐛 Troubleshooting

### Problem: `yt-dlp not found` after deploy

```bash
# Check if Python buildpack installed it
heroku run "yt-dlp --version"

# If not, force reinstall
heroku run "pip install yt-dlp"

# Then restart
heroku restart
```

---

### Problem: Build fails with Node errors

```bash
# Check logs
heroku logs --tail

# Common fix: ensure package.json engines field is set
# It should have: "engines": { "node": ">=18.0.0" }
```

---

### Problem: `git push heroku main` — "no such remote"

```bash
# Add remote manually
heroku git:remote -a YOUR-APP-NAME
git push heroku main
```

---

### Problem: App crashes immediately

```bash
heroku logs --tail
# Look for the error, then:

# Most common: port binding issue (already handled in server.js)
# or missing dependency
npm install --save MISSING_PACKAGE
git add . && git commit -m "fix: add missing dep"
git push heroku main
```

---

### Problem: Downloads fail (403 Forbidden)

Some platforms block Heroku's IP ranges.

**Fixes:**
- YouTube: usually works fine
- Instagram: may need cookies (see below)
- TikTok: works via yt-dlp's built-in handler

**Adding cookies (advanced):**
```bash
# Export cookies from your browser using a browser extension
# Then set as env variable
heroku config:set YTDLP_COOKIES="your-cookies-content"
```

---

### Problem: App sleeps (free tier)

Heroku eco/free dynos sleep after 30 min of inactivity.

**Fix — Use UptimeRobot (free):**
1. Go to https://uptimerobot.com
2. Create a free account
3. Add new monitor → HTTP(s)
4. URL: `https://YOUR-APP.herokuapp.com/api/status`
5. Interval: every 25 minutes
6. This keeps your app awake 24/7!

---

## 🔄 Updating Your App

After making changes:

```bash
git add .
git commit -m "Update: describe your changes"
git push heroku main
```

---

## 📊 Monitor Your App

```bash
# Live logs
heroku logs --tail

# App info
heroku info

# Dyno status
heroku ps

# Restart app
heroku restart

# Run command on dyno
heroku run bash
heroku run "yt-dlp --version"
heroku run "node -e 'console.log(process.version)'"
```

---

## 💰 Heroku Pricing

| Plan | Price | Sleep? | RAM |
|------|-------|--------|-----|
| Eco Dyno | $5/mo | Yes (30min) | 512MB |
| Basic Dyno | $7/mo | No | 512MB |
| Standard-1X | $25/mo | No | 512MB |

For a production app, **Basic Dyno ($7/mo)** is recommended so it doesn't sleep.

---

## 🌍 Alternative Hosting (if not Heroku)

### Railway.app (easier, free tier)
```bash
# Install Railway CLI
npm install -g @railway/cli

railway login
railway init
railway up
```

### Render.com (free tier)
1. Connect GitHub repo
2. Set build command: `npm install`
3. Set start command: `node server.js`
4. Add environment variables in dashboard
5. Deploy!

### VPS (DigitalOcean / Linode)
```bash
# On your VPS
git clone YOUR_REPO
cd ps-downloader
npm install
pip3 install yt-dlp
npm start

# Use PM2 to keep running
npm install -g pm2
pm2 start server.js --name ps-downloader
pm2 startup
pm2 save
```

---

## ✅ Deployment Checklist

- [ ] Heroku CLI installed and logged in
- [ ] Git initialized and committed
- [ ] Heroku app created
- [ ] Both buildpacks set (nodejs + python)
- [ ] Environment variables set
- [ ] `git push heroku main` succeeded
- [ ] `/api/status` returns `"ytdlp": true`
- [ ] Test download works in browser
- [ ] UptimeRobot configured (optional but recommended)

---

**🎉 You're live! Share your PS Downloader URL with the world.**
