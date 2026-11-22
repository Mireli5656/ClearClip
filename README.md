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

TikTok gives you the HD and standard video without watermark, plus the MP3 audio. Instagram returns whatever the Worker finds for the post: a video, a photo, or every item of a carousel.

## How it works

Browsers can't read these platforms directly, so ClearClip asks a service for the clean file link:

- **TikTok**: the public [TikWM](https://www.tikwm.com) API. The page uses the `www.tikwm.com` address on purpose: `tikwm.com` redirects, and a redirect breaks the browser's CORS check.
- **Instagram**: your own Cloudflare Worker, `https://ig-media-api.miraliseyidli5656.workers.dev`.

Your links are sent to these services. Nothing is stored in this repository.

## Instagram Worker

The page calls the Worker like this:

```
GET <worker>/?url=<instagram link>
```

If your Worker uses another path, ClearClip also tries `/api`, `/media`, `/download`, `/api/media`, `/api/instagram` and `/instagram`, and keeps the first one that answers with media. To pin the exact path or change the address, edit the constants at the top of `script.js` (`IG_WORKER`, `IG_PATHS`).

The response is read flexibly. It can be a single URL (`video_url`, `url`, `download_url`) or a list (`media`, `items`, `links`), with an optional `thumbnail`, `caption` or `title`, and `username`. A post page link from `instagram.com` is never treated as a media file.

### CORS

The Worker must allow requests from your Pages site, or the browser blocks them. Add these headers to every Worker response, and answer `OPTIONS` requests:

```js
const CORS = {
  "Access-Control-Allow-Origin": "https://<your-username>.github.io",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
```

Use your exact site origin (no path) instead of `*` if you want only your own page to use the Worker.

## Fonts

The page loads two fonts from Google Fonts (Bricolage Grotesque and Instrument Sans). To go fully dependency-free, delete the three Google Fonts lines in `index.html`; the page falls back to system fonts.

## Good to know

- Only **public** videos work.
- Platforms change often. If TikTok or Instagram stops working, the service behind it may need an update.
- Third-party services can go down or change without notice.

## Disclaimer

For personal use only. Respect creators' rights and each platform's terms of service. Don't re-upload other people's work as your own.
