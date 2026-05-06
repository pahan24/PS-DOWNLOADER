# 🔴 PS DOWNLOADER

> Fast, free, multi-platform video & audio downloader.  
> Supports YouTube, TikTok, Instagram, Facebook, Twitter/X, Reddit, Vimeo & 1000+ more sites.

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Media Engine | yt-dlp (auto-downloaded on install) |
| Frontend | Vanilla HTML/CSS/JS (served as static files) |
| Hosting | Heroku (or any Node.js host) |
| Rate Limiting | express-rate-limit |
| Security | helmet, cors |

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js >= 18
- npm >= 8
- Python 3 (optional, for pip-based yt-dlp fallback)

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/ps-downloader.git
cd ps-downloader
npm install
# postinstall automatically downloads yt-dlp binary to ./bin/
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env as needed (defaults work for local dev)
```

### 3. Run

```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

### 4. Open

```
http://localhost:3000
```

---

## ☁️ Deploy to Heroku (Step by Step)

### Prerequisites
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- Heroku account (free tier works)
- Git installed

### Step 1 — Login to Heroku

```bash
heroku login
```

### Step 2 — Create Heroku App

```bash
heroku create ps-downloader-yourname
# or let Heroku pick a random name:
heroku create
```

### Step 3 — Set Buildpacks

PS Downloader needs both Node.js and Python (for yt-dlp):

```bash
# Set Node.js buildpack (primary)
heroku buildpacks:set heroku/nodejs

# Add Python buildpack (for yt-dlp pip fallback)
heroku buildpacks:add heroku/python
```

### Step 4 — Set Environment Variables

```bash
heroku config:set NODE_ENV=production
heroku config:set RATE_LIMIT_MAX_REQUESTS=30
heroku config:set RATE_LIMIT_WINDOW_MS=60000
```

### Step 5 — Add runtime.txt (Node version)

```bash
echo "nodejs-20.x" > .nvmrc
```

### Step 6 — Create requirements.txt (for Python/yt-dlp)

```bash
echo "yt-dlp" > requirements.txt
```

### Step 7 — Initialize Git & Deploy

```bash
git init
git add .
git commit -m "Initial deploy — PS Downloader"
git push heroku main
```

### Step 8 — Open Your App

```bash
heroku open
```

### Step 9 — View Logs (if something goes wrong)

```bash
heroku logs --tail
```

---

## 🔧 Heroku Troubleshooting

### yt-dlp not found
```bash
# SSH into dyno and check
heroku run bash
which yt-dlp
yt-dlp --version

# If missing, force reinstall
heroku run "pip install yt-dlp"
```

### App crashes on startup
```bash
heroku logs --tail
# Most common cause: missing node_modules or wrong Node version
heroku config:set NPM_CONFIG_PRODUCTION=false
git push heroku main
```

### Downloads failing (403 / geo-block)
- Some platforms block Heroku's US IP ranges
- Consider adding a proxy or VPN layer
- YouTube generally works fine

### Timeout errors
- Heroku free dynos sleep after 30 min inactivity
- First request after sleep takes ~10s to wake up
- Use [UptimeRobot](https://uptimerobot.com) to ping every 25 min

---

## 📁 Project Structure

```
ps-downloader/
├── server.js              # Express server (entry point)
├── Procfile               # Heroku process file
├── package.json           # Dependencies & scripts
├── requirements.txt       # Python deps (yt-dlp for Heroku)
├── .env.example           # Environment variable template
├── .gitignore
│
├── routes/
│   └── api.js             # API endpoints (info, download, proxy)
│
├── utils/
│   ├── ytdlp.js           # yt-dlp binary wrapper
│   └── platformDetector.js # URL platform detection
│
├── scripts/
│   └── setup-ytdlp.js     # Auto-downloads yt-dlp on npm install
│
├── bin/
│   └── yt-dlp             # Auto-downloaded binary (gitignored)
│
└── public/
    └── index.html         # Full frontend SPA
```

---

## 🔌 API Reference

### `GET /api/status`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "ytdlp": true,
  "ytdlpVersion": "2024.xx.xx",
  "supportedPlatforms": ["YouTube", "TikTok", ...]
}
```

---

### `POST /api/info`
Fetch media info and available formats for a URL.

**Request:**
```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

**Response:**
```json
{
  "success": true,
  "platform": { "platform": "youtube", "name": "YouTube", "color": "#ff0000" },
  "media": {
    "title": "Video Title",
    "thumbnail": "https://...",
    "duration": "3:32",
    "uploader": "Channel Name",
    "viewCount": "1,234,567",
    "formats": [
      { "id": "hd", "label": "HD 1080p", "type": "video", "ext": "mp4", "quality": "1080p", "size": "45.2 MB", "tag": "HD", "icon": "🎬" },
      { "id": "mp3", "label": "MP3 Audio", "type": "audio", "ext": "mp3", "quality": "128kbps", "tag": "MP3", "icon": "🎵" }
    ]
  }
}
```

---

### `POST /api/download`
Get a direct stream URL for a specific format.

**Request:**
```json
{ "url": "https://...", "formatId": "hd", "type": "video", "ext": "mp4" }
```

**Response:**
```json
{
  "success": true,
  "downloadUrl": "https://direct-stream-url...",
  "formatId": "hd",
  "type": "video",
  "ext": "mp4"
}
```

---

### `GET /api/proxy-download`
Proxies the file through the server (forces browser download dialog).

**Query params:** `url`, `filename`, `ext`

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port (auto-set by Heroku) |
| `NODE_ENV` | `development` | Environment mode |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `30` | Max requests per window per IP |
| `ALLOWED_ORIGIN` | — | CORS allowed origin (optional) |

---

## 🔒 Security Notes

- All routes protected by `helmet` security headers
- Rate limiting prevents abuse (30 req/min per IP)
- No user data or URLs are stored after processing
- CSP headers prevent XSS
- Input validation on all API endpoints

---

## 📜 Legal Disclaimer

PS Downloader is provided for educational and personal use only.  
Only download content you own or have explicit permission to download.  
The developers are not responsible for misuse or copyright infringement.  
Always respect each platform's Terms of Service.

---

## 🛠 Local Development Tips

```bash
# Watch logs
npm run dev

# Test API directly
curl -X POST http://localhost:3000/api/info \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# Check yt-dlp version
./bin/yt-dlp --version

# Update yt-dlp manually
./bin/yt-dlp -U
```

---

## 📄 License

MIT License — see LICENSE file.

---

**Made with ❤️ — PS DOWNLOADER © 2026**
