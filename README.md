# ClearClip

Save public **TikTok** and **Instagram** videos in the best quality available, straight from your phone.

ClearClip is a small static website: plain HTML, CSS and JavaScript, no build tools, no dependencies. It runs on **GitHub Pages**.

## Files

| File         | Purpose                                              |
|--------------|------------------------------------------------------|
| `index.html` | Page structure                                       |
| `style.css`  | Design (light and dark theme, mobile first)          |
| `script.js`  | Platform switch, TikTok and Instagram requests, UI   |

## Deploy

1. Put `index.html`, `style.css` and `script.js` in the root of the repository.
2. Go to **Settings, Pages, Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
3. Open `https://<your-username>.github.io/<repository>/`.

## How to use

1. Pick **TikTok** or **Instagram** (the page also switches by itself when you paste a link from the other platform).
2. Paste the link and tap **Get video**.
3. Check the preview card, then tap a download button. **Copy link** gives you the direct file link.

TikTok gives you the HD and standard video without watermark, plus the MP3 audio. Instagram gives you the **video file** (HD). The Worker is video-only, so you never get a photo.

## How it works

Browsers can't read these platforms directly, so ClearClip asks a service for the clean file link:

- **TikTok**: the public [TikWM](https://www.tikwm.com) API. The page uses the `www.tikwm.com` address on purpose: `tikwm.com` redirects, and a redirect breaks the browser's CORS check.
- **Instagram**: your own Cloudflare Worker, `https://ig-media-api.miraliseyidli5656.workers.dev`.

Your links are sent to these services. Nothing is stored in this repository.

## Instagram Worker

The page uses two endpoints of your Cloudflare Worker (`IG_WORKER` at the top of `script.js`):

| Endpoint | What it does |
|----------|--------------|
| `GET /api/media?url=<instagram link>` | Returns the video details: `title`, `thumbnail`, `quality`, `filename` and the CDN `url`. Only public posts, reels and `tv` links work. |
| `GET /api/download?mediaUrl=<cdn url>&filename=<name>` | Streams the video file with a download header. Instagram's CDN blocks direct hotlinking, so every Instagram download goes through this endpoint. |

The Worker sends `Access-Control-Allow-Origin: *`, so the page can call it from GitHub Pages without extra setup. If you want only your own site to use it, change that header to your exact Pages origin (for example `https://<your-username>.github.io`, no path) in the Worker.

If the Worker can't read a post, the page shows its message (for example "No direct video stream found"). Some public posts can't be read this way; that comes from the Worker's source, not from the page.

## Fonts

The page loads two fonts from Google Fonts (Bricolage Grotesque and Instrument Sans). To go fully dependency-free, delete the three Google Fonts lines in `index.html`; the page falls back to system fonts.

## Good to know

- Only **public** videos work.
- Platforms change often. If TikTok or Instagram stops working, the service behind it may need an update.
- Third-party services can go down or change without notice.

## Disclaimer

For personal use only. Respect creators' rights and each platform's terms of service. Don't re-upload other people's work as your own.
