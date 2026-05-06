# 🔧 Heroku Fix — "node: command not found"

## Root Cause
Python buildpack was running LAST, overriding the PATH so `node` wasn't found
when Heroku tried to execute the Procfile command.

## What Was Fixed
1. **Procfile** — changed `node server.js` → `npm start` (npm resolves node path correctly)
2. **package.json** — pinned `"node": "20.x"` exact version, removed unused `youtubei.js`
3. **runtime.txt** — added `nodejs-20.x` for explicit Heroku node version
4. **requirements.txt** — pinned `yt-dlp>=2024.1.1` for stability
5. **server.js** — cleaner startup, no crash on postinstall errors

## Re-Deploy Steps (Run These Exactly)

### Step 1 — Clear old buildpacks and re-add in correct order
```bash
heroku buildpacks:clear
heroku buildpacks:add heroku/nodejs    # Node FIRST ← critical
heroku buildpacks:add heroku/python    # Python second
heroku buildpacks
# Should show:
# 1. heroku/nodejs
# 2. heroku/python
```

### Step 2 — Commit all the fixed files
```bash
git add .
git commit -m "fix: heroku node path error - pin node 20, fix Procfile"
```

### Step 3 — Deploy
```bash
git push heroku main
```

### Step 4 — Verify
```bash
heroku open
# Visit: https://your-app.herokuapp.com/api/status
# Should return: { "status": "ok", "ytdlp": true, ... }
```

### Step 5 — Check logs if still failing
```bash
heroku logs --tail
```

## If It Still Fails

### Try forcing Node version
```bash
heroku config:set NODE_ENV=production
heroku config:set NPM_CONFIG_PRODUCTION=false
git push heroku main
```

### Verify buildpack order (MUST be nodejs first)
```bash
heroku buildpacks
# If wrong order:
heroku buildpacks:clear
heroku buildpacks:set heroku/nodejs
heroku buildpacks:add heroku/python
```

### Nuclear option — destroy and recreate
```bash
heroku apps:destroy --app YOUR-APP-NAME --confirm YOUR-APP-NAME
heroku create YOUR-APP-NAME
heroku buildpacks:add heroku/nodejs
heroku buildpacks:add heroku/python
heroku config:set NODE_ENV=production
git push heroku main
heroku open
```
