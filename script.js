/* ClearClip: script.js
   Vanilla JavaScript, no dependencies, no build step.

   TikTok    -> TikWM public API
   Instagram -> your own Cloudflare Worker (video only) */
(() => {
  "use strict";

  // ---------- configuration ----------

  // Your Instagram Worker (see README). It exposes:
  //   GET /api/media?url=<instagram link>                 video details
  //   GET /api/download?mediaUrl=<cdn url>&filename=...   the video file as a download
  const IG_WORKER = "https://ig-media-api.miraliseyidli5656.workers.dev";

  // Keep "www": tikwm.com redirects to www, and a redirect breaks the browser's CORS check.
  const TIKWM = "https://www.tikwm.com";

  // ---------- helpers ----------

  const $ = (id) => document.getElementById(id);

  const store = {
    get(key) {
      try { return localStorage.getItem(key) || ""; } catch { return ""; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    }
  };

  const PLATFORMS = {
    TikTok: {
      domains: ["tiktok.com"],
      placeholder: "https://www.tiktok.com/@user/video/…",
      idle: "Paste a TikTok link",
      fallbackTitle: "TikTok video"
    },
    Instagram: {
      domains: ["instagram.com", "instagr.am"],
      placeholder: "https://www.instagram.com/reel/…",
      idle: "Paste an Instagram link",
      fallbackTitle: "Instagram post"
    }
  };

  const withScheme = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

  // People often paste "Look at this https://…": keep only the link.
  function extractUrl(text) {
    const value = (text || "").trim();
    const match = value.match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : value;
  }

  function detect(link) {
    let host;
    try { host = new URL(link).hostname.toLowerCase(); } catch { return null; }
    for (const [name, def] of Object.entries(PLATFORMS)) {
      if (def.domains.some((d) => host === d || host.endsWith(`.${d}`))) return name;
    }
    return null;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch { return null; }
  }

  const DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

  // ---------- elements and state ----------

  const frame = $("frame");
  const linkInput = $("link");
  const goButton = $("go");
  const statusEl = $("status");
  const resultEl = $("result");
  const pill = $("pill");

  let busy = false;

  const selected = () => document.querySelector('input[name="platform"]:checked').value;

  // ---------- UI state ----------

  function setStatus(message, kind = "") {
    statusEl.className = `status ${kind}`.trim();
    statusEl.textContent = message || "";
  }

  function setBusy(value) {
    busy = value;
    goButton.disabled = value;
    goButton.setAttribute("aria-busy", String(value));
    goButton.textContent = value ? "Getting video…" : "Get video";
    frame.classList.toggle("is-busy", value);
  }

  function resetResult() {
    frame.classList.remove("is-clear");
    resultEl.replaceChildren();
    setStatus("");
  }

  function updatePill() {
    const raw = extractUrl(linkInput.value);
    if (!raw) {
      pill.dataset.state = "idle";
      pill.textContent = PLATFORMS[selected()].idle;
      return;
    }
    const platform = detect(withScheme(raw));
    pill.dataset.state = platform ? "ok" : "bad";
    pill.textContent = platform ? `${platform} link` : "Unsupported link";
  }

  function applyPlatform(name) {
    const radio = document.querySelector(`input[name="platform"][value="${name}"]`);
    if (!radio) return;
    radio.checked = true;
    linkInput.placeholder = PLATFORMS[name].placeholder;
    store.set("cc_platform", name);
    updatePill();
  }

  // Switch the platform automatically when the pasted link belongs to the other one.
  function syncFromInput() {
    const raw = extractUrl(linkInput.value);
    const platform = raw ? detect(withScheme(raw)) : null;
    if (platform && platform !== selected()) applyPlatform(platform);
    else updatePill();
  }

  // ---------- network ----------

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("The request timed out. Try again in a moment.");
      }
      throw new Error(
        "Couldn't reach the service. Check your connection. For Instagram, the Worker must also allow requests from this site (CORS)."
      );
    } finally {
      clearTimeout(timer);
    }
    try {
      return await response.json();
    } catch {
      const error = new Error(`The service sent an unexpected response (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
  }

  // ---------- TikTok (TikWM) ----------

  async function viaTikwm(link, retried = false) {
    const data = await fetchJson(`${TIKWM}/api/?url=${encodeURIComponent(link)}&hd=1`);

    if (!data || data.code !== 0 || !data.data) {
      const reason = data && data.msg ? String(data.msg) : "";
      if (!retried && /limit/i.test(reason)) {
        // the free API allows about one request per second: wait and retry once
        await new Promise((resolve) => setTimeout(resolve, 1300));
        return viaTikwm(link, true);
      }
      throw new Error(
        reason
          ? `The TikTok service replied: ${reason}`
          : "Couldn't find this TikTok video, or the TikTok service isn't responding."
      );
    }

    const d = data.data;
    const absolute = (u) => (u && u.startsWith("/") ? `${TIKWM}${u}` : u);
    const hd = absolute(d.hdplay);
    const sd = absolute(d.play);
    const music = absolute(typeof d.music === "string" ? d.music : d.music_info && d.music_info.play);
    const id = String(d.id || "video").replace(/[^\w-]/g, "");

    const items = [];
    if (hd) items.push({ label: "Download HD video", url: hd, name: `clearclip_${id}_hd.mp4`, openOnFail: true });
    if (sd && sd !== hd) items.push({ label: "Download standard video", url: sd, name: `clearclip_${id}.mp4`, openOnFail: true });
    if (!items.length) throw new Error("No watermark-free version was found for this video.");
    if (music) items.push({ label: "Download MP3 audio", url: music, name: `clearclip_${id}.mp3`, openOnFail: true });

    return {
      items,
      meta: {
        cover: absolute(d.cover),
        title: d.title || "",
        author: d.author && d.author.unique_id ? `@${d.author.unique_id}` : "",
        fallbackTitle: PLATFORMS.TikTok.fallbackTitle
      }
    };
  }

  // ---------- Instagram (your Cloudflare Worker) ----------
  // /api/media returns { success, data: { shortcode, title, items: [{ type: "video", quality, url, thumbnail, filename }] } }.
  // The video itself is fetched through /api/download, because Instagram's CDN blocks direct hotlinking.

  const isHttpUrl = (value) => typeof value === "string" && Boolean(safeUrl(value.trim()));

  async function viaInstagram(link) {
    if (!/^\/(p|reel|reels|tv)\/[\w-]+/i.test(new URL(link).pathname)) {
      throw new Error("Use a link to a public Instagram post or reel (instagram.com/reel/…).");
    }

    const payload = await fetchJson(`${IG_WORKER}/api/media?url=${encodeURIComponent(link)}`);
    if (!payload || payload.success !== true || !payload.data) {
      const reason = payload && typeof payload.error === "string" ? payload.error : "";
      throw new Error(
        reason ? `The Instagram service replied: ${reason}` : "The Instagram service sent an unexpected response."
      );
    }

    const data = payload.data;
    const videos = (Array.isArray(data.items) ? data.items : []).filter(
      (entry) => entry && entry.type === "video" && isHttpUrl(entry.url)
    );
    if (!videos.length) throw new Error("No video file was found for this post. Check that it is public.");

    const items = videos.map((video, index) => {
      const filename = String(video.filename || `ig_${data.shortcode || "video"}.mp4`);
      const quality = typeof video.quality === "string" && video.quality ? `${video.quality} ` : "";
      return {
        label: videos.length === 1 ? `Download ${quality}video` : `Download ${quality}video ${index + 1}`,
        url: `${IG_WORKER}/api/download?mediaUrl=${encodeURIComponent(video.url.trim())}&filename=${encodeURIComponent(filename)}`,
        name: filename,
        openOnFail: false
      };
    });

    // Instagram titles look like:  Name on Instagram: "caption"
    const rawTitle = typeof data.title === "string" ? data.title.trim() : "";
    const match = rawTitle.match(/^(.+?) on Instagram:\s*["“]?([\s\S]*?)["”]?$/);

    return {
      items,
      meta: {
        cover: videos.map((video) => video.thumbnail).find(isHttpUrl) || "",
        title: match ? match[2] : rawTitle,
        author: match ? match[1] : "",
        fallbackTitle: PLATFORMS.Instagram.fallbackTitle
      }
    };
  }

  // ---------- results ----------

  // Saves the file from inside the page so it lands in Downloads with a proper name.
  // If the host blocks that (CORS), open the file directly instead.
  async function saveAsFile(href, name, link, openOnFail) {
    if (link.dataset.busy) return;
    link.dataset.busy = "1";
    const label = link.lastChild;
    const original = label.textContent;
    label.textContent = "Downloading…";
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const temp = document.createElement("a");
      temp.href = blobUrl;
      temp.download = name || "clearclip";
      document.body.append(temp);
      temp.click();
      temp.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      setStatus("Download started. Check your Downloads folder.", "ok");
    } catch {
      if (openOnFail) {
        const opened = window.open(href, "_blank");
        if (opened) opened.opener = null;
        else window.location.href = href;
      } else {
        setStatus("The download failed. Try again in a moment.", "err");
      }
    } finally {
      label.textContent = original;
      delete link.dataset.busy;
    }
  }

  function buildMeta(meta) {
    const card = document.createElement("div");
    card.className = "meta";

    const cover = safeUrl(meta.cover || "");
    if (cover) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = cover;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove());
      card.append(img);
    }

    const text = document.createElement("div");
    text.className = "meta-text";

    const title = document.createElement("div");
    title.className = "meta-title";
    title.textContent = (meta.title || meta.fallbackTitle || "Video").slice(0, 90); // textContent: never HTML
    text.append(title);

    if (meta.author) {
      const author = document.createElement("div");
      author.className = "meta-author";
      author.textContent = meta.author;
      text.append(author);
    }

    card.append(text);
    return card;
  }

  function showResult({ items, meta }, platform) {
    resultEl.replaceChildren();
    if (meta) resultEl.append(buildMeta(meta));

    let count = 0;
    for (const entry of items) {
      const href = safeUrl(entry.url);
      if (!href) continue;

      const row = document.createElement("div");
      row.className = "item";

      const link = document.createElement("a");
      link.className = "dl";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.insertAdjacentHTML("afterbegin", DOWNLOAD_ICON); // static markup only
      link.append(document.createTextNode(entry.label));
      link.addEventListener("click", (event) => {
        event.preventDefault();
        saveAsFile(href, entry.name, link, entry.openOnFail);
      });

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.textContent = "Copy link";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(href);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy failed";
        }
        setTimeout(() => { copy.textContent = "Copy link"; }, 1600);
      });

      row.append(link, copy);
      resultEl.append(row);
      count++;
    }

    if (!count) {
      resultEl.replaceChildren();
      setStatus("The service didn't return a download link. Try again.", "err");
      return;
    }
    frame.classList.add("is-clear");
    setStatus(`${platform}: ready. Choose a download below.`, "ok");
  }

  // ---------- main flow ----------

  async function run(event) {
    event.preventDefault();
    if (busy) return;
    resetResult();

    const raw = extractUrl(linkInput.value);
    if (!raw) {
      setStatus("Paste a video link first.", "err");
      linkInput.focus();
      return;
    }

    const link = withScheme(raw);
    const platform = detect(link);
    if (!platform) {
      setStatus("This link isn't supported. Use a link from TikTok or Instagram.", "err");
      return;
    }

    linkInput.value = link;
    if (platform !== selected()) applyPlatform(platform);

    setBusy(true);
    setStatus(`Getting your ${platform} video…`);

    try {
      const result = platform === "TikTok" ? await viaTikwm(link) : await viaInstagram(link);
      showResult(result, platform);
    } catch (error) {
      setStatus(error.message || "Something went wrong. Try again.", "err");
    } finally {
      setBusy(false);
    }
  }

  // ---------- wire up ----------

  $("form").addEventListener("submit", run);

  linkInput.addEventListener("input", () => {
    syncFromInput();
    resetResult();
  });

  document.querySelectorAll('input[name="platform"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      // switching platform by hand: drop a link that belongs to the other one
      const detected = detect(withScheme(extractUrl(linkInput.value)));
      if (detected && detected !== radio.value) linkInput.value = "";
      applyPlatform(radio.value);
      resetResult();
    });
  });

  $("paste").addEventListener("click", async () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setStatus("This browser can't read the clipboard. Paste the link into the field instead.", "err");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      linkInput.value = extractUrl(text);
      syncFromInput();
      resetResult();
      linkInput.focus();
    } catch {
      setStatus("Clipboard access was denied. Paste the link into the field instead.", "err");
    }
  });

  const saved = store.get("cc_platform");
  applyPlatform(PLATFORMS[saved] ? saved : "TikTok");
})();
