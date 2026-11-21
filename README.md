# ClearClip

Save public videos **without the watermark**, in the **best quality available**, from **TikTok, Instagram, Snapchat and Facebook**. Built for phones.

ClearClip is a small static website: plain HTML, CSS and JavaScript, no build tools, no dependencies. It runs on **GitHub Pages**.

## Files

| File         | Purpose                                      |
|--------------|----------------------------------------------|
| `index.html` | Page structure                               |
| `style.css`  | Design (light and dark theme, mobile first)  |
| `script.js`  | Link detection, downloads, settings          |

Optional, for the no-instance alternative below: `clearclip.py`, `requirements.txt`, `.github/workflows/download.yml`.

## Deploy

1. Put `index.html`, `style.css` and `script.js` in the root of the repository.
2. Go to **Settings, Pages, Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
3. Open `https://<your-username>.github.io/ClearClip/`.

## How it works

Browsers can't read these platforms directly: they block cross-site requests (CORS) and the platforms block bots. So ClearClip asks an extractor service for the clean video link and shows you a download button.

- **TikTok** works with no setup, through the public tikwm.com API (HD, no watermark).
- **Instagram, Snapchat and Facebook** need a **Cobalt API instance**. Open **Connection settings** in the page (the sliders icon), enter the instance address and, if it asks for one, an API key. These are saved in your browser only and are never written to the code.
- If you set an instance, it is used for every platform. For TikTok, tikwm is the fallback if the instance fails.

Your links are sent to the service you use. Nothing is stored in this repository.

### Getting a Cobalt instance

- The public `api.cobalt.tools` uses bot protection and isn't meant for other projects without permission. Don't rely on it.
- Run your own instance (see the [cobalt docs](https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md); one-click templates exist on some hosts), or ask an instance owner for access.
- The instance must allow requests from your Pages address (CORS) and must be served over `https`.
- Never put an API key in `index.html` or `script.js`. The site is public.

## Quality

- **Best** asks for the highest quality the source has, up to 4K.
- **1080p** and **720p** cap the quality.

The result can't be better than what was originally uploaded.

## Fonts

The page loads two fonts from Google Fonts (Bricolage Grotesque and Instrument Sans). To go fully dependency-free, delete the three Google Fonts lines in `index.html`; the page falls back to system fonts.

## Alternative: no instance needed (GitHub Actions)

You can also download videos on GitHub's servers with [yt-dlp](https://github.com/yt-dlp/yt-dlp):

1. Add `clearclip.py`, `requirements.txt` and `download.yml` (as `.github/workflows/download.yml`).
2. Open **Actions, Download videos, Run workflow**, paste the link(s) and pick the quality.
3. When the run is green, download **videos** from the **Artifacts** section.

Instagram, Facebook and Snapchat sometimes block GitHub's servers. If that happens, add a repository secret named `COOKIES_TXT` containing a Netscape-format `cookies.txt` from a logged-in browser. Never commit cookies to the repository.

## Good to know

- Only **public** videos work.
- Platforms change often. If a site stops working, update your Cobalt instance.
- Third-party services can go down or change without notice.

## Disclaimer

For personal use only. Respect creators' rights and each platform's terms of service. Don't re-upload other people's work as your own.
