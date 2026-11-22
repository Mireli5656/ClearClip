/* ClearClip: script.js
   Vanilla JavaScript, no dependencies, no build step.

   TikTok    -> TikWM public API
   Instagram -> your own Cloudflare Worker (see the constants below) */
(() => {
  "use strict";

  // ---------- configuration ----------

  // Your Instagram Worker. The page calls  <IG_WORKER><path>?url=<instagram link>
  const IG_WORKER = "https://ig-media-api.miraliseyidli5656.workers.dev";

  // Paths are tried in order until the Worker answers with media; the one that works is
  // remembered for the session. If you know your Worker's real path, put it first.
  const IG_PATHS = ["/", "/api", "/media", "/download", "/api/media", "/api/instagram", "/instagram"];

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
  let igPath = ""; // first Worker path that returned media

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
    if (hd) items.push({ label: "Download HD video", url: hd, name: `clearclip_${id}_hd.mp4` });
    if (sd && sd !== hd) items.push({ label: "Download standard video", url: sd, name: `clearclip_${id}.mp4` });
    if (!items.length) throw new Error("No watermark-free version was found for this video.");
    if (music) items.push({ label: "Download MP3 audio", url: music, name: `clearclip_${id}.mp3` });

    return {
      items,
      meta: {
        cover: absolute(d.cover),
        title: d.title || "",
        author: (d.author && d.author.unique_id) || "",
        fallbackTitle: PLATFORMS.TikTok.fallbackTitle
      }
    };
  }

  // ---------- Instagram (your Cloudflare Worker) ----------
  // The Worker's response is searched for media files wherever they sit. Video files always win:
  // images are only used for the preview card, or offered when the post is a photo-only post.

  const ROUTE_ERROR = /\b(route|endpoint)\b|cannot (get|post)|^\s*(404\s*)?not found\s*$/i;
  const SKIP_KEYS = /^(user|owner|author|avatar|profile|profile_pic\w*|account|uploader|music|audio)$/i;
  const VARIANT_KEYS = /version|format|quality|source|variant|resolution/i;

  const asText = (value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") return asText(value.text || value.caption || "");
    return "";
  };

  // A real media URL: http(s), and not the Instagram post page itself.
  function isMediaUrl(value) {
    const href = typeof value === "string" ? safeUrl(value.trim()) : null;
    if (!href) return false;
    const host = new URL(href).hostname.toLowerCase();
    return !(host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am");
  }

  // Best guess of what a URL is: "video", "photo", "audio" or "unknown" (e.g. a proxied download link).
  function classify(url, key, parent) {
    const path = url.split("?")[0].toLowerCase();
    if (/\.(mp4|mov|webm|m4v)$/.test(path)) return "video";
    if (/\.(jpe?g|png|webp|heic|gif)$/.test(path)) return "photo";
    if (/\.(mp3|m4a|aac|ogg|wav)$/.test(path)) return "audio";

    const k = String(key).toLowerCase();
    if (/video|mp4|play|stream|reel/.test(k)) return "video";
    if (/image|photo|thumb|cover|display|poster|preview|pic/.test(k)) return "photo";

    const hint = String((parent && (parent.type || parent.media_type || parent.mediaType || parent.kind)) || "").toLowerCase();
    if ((parent && parent.is_video === true) || hint === "2" || /video|reel/.test(hint)) return "video";
    if (hint === "1" || /image|photo|sidecar/.test(hint)) return "photo";
    return "unknown";
  }

  // Walk the whole response and collect every media URL with its best-guess type.
  function collectMedia(node, state, key = "", parent = null, group = "", depth = 0) {
    if (node == null || depth > 8) return;

    if (typeof node === "string") {
      const url = node.trim();
      if (!isMediaUrl(url) || state.seen.has(url)) return;
      const kind = classify(url, key, parent);
      if (kind === "audio") return;
      state.seen.add(url);
      state.found.push({
        url,
        key,
        kind,
        group,
        area: parent ? (Number(parent.width) || 0) * (Number(parent.height) || 0) : 0
      });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item) => collectMedia(item, state, key, parent, key, depth + 1));
      return;
    }

    if (typeof node === "object") {
      for (const [childKey, value] of Object.entries(node)) {
        if (SKIP_KEYS.test(childKey)) continue;
        collectMedia(value, state, childKey, node, group, depth + 1);
      }
    }
  }

  // Several qualities of the same video (video_versions, formats...): keep only the biggest.
  function bestVariants(list) {
    const best = new Map();
    const rest = [];
    for (const item of list) {
      if (VARIANT_KEYS.test(item.group)) {
        const current = best.get(item.group);
        if (!current || item.area > current.area) best.set(item.group, item);
      } else {
        rest.push(item);
      }
    }
    return [...best.values(), ...rest].sort((a, b) => b.area - a.area);
  }

  function unwrap(payload) {
    let node = payload;
    for (const key of ["data", "result", "response"]) {
      if (node && typeof node === "object" && !Array.isArray(node) && node[key] && typeof node[key] === "object") {
        node = node[key];
      }
    }
    return node;
  }

  function parseInstagram(payload, link) {
    if (!payload || typeof payload !== "object") return null;
    const root = unwrap(payload);
    if (!root || typeof root !== "object") return null;

    const state = { seen: new Set(), found: [] };
    collectMedia(root, state);
    if (!state.found.length) return null;

    const videos = bestVariants(state.found.filter((m) => m.kind === "video"));
    const unknown = state.found.filter((m) => m.kind === "unknown");
    const photos = state.found.filter((m) => m.kind === "photo");

    const isVideoPost =
      /\/(reel|reels|tv)\//i.test(link || "") ||
      root.is_video === true ||
      /video|reel/i.test(String(root.type || root.media_type || ""));

    // video files first, then links of unknown type (usually proxied downloads), photos last
    let chosen = videos.length ? videos : unknown;
    let kind = "video";
    if (!chosen.length) {
      if (isVideoPost) {
        console.warn("ClearClip: the Worker sent no video file for this post.", payload);
        throw new Error(
          `The Worker sent only a preview image, not the video file. Fields it returned: ${Object.keys(root).join(", ") || "none"}.`
        );
      }
      chosen = photos;
      kind = "photo";
    }

    const noun = kind === "photo" ? "photo" : "video";
    const ext = kind === "photo" ? "jpg" : "mp4";
    const items = chosen.map((m, index) => ({
      label: chosen.length === 1 ? `Download ${noun}` : `Download ${noun} ${index + 1}`,
      url: m.url,
      name: `clearclip_instagram_${index + 1}.${ext}`
    }));

    const owner = root.owner || root.user || root.author;
    const author = (
      asText(root.username) ||
      asText(owner && typeof owner === "object" ? owner.username : owner) ||
      asText(root.uploader)
    ).replace(/^@/, "");

    const cover = (photos.find((m) => /thumb|cover|display|preview|poster|image/i.test(m.key)) || photos[0] || {}).url || "";

    return {
      items,
      meta: {
        cover,
        title: asText(root.title) || asText(root.caption) || asText(root.description) || asText(root.text),
        author,
        fallbackTitle: PLATFORMS.Instagram.fallbackTitle
      }
    };
  }

  function workerMessage(payload) {
    if (!payload || typeof payload !== "object") return "";
    const message = asText(payload.error) || asText(payload.message) || asText(payload.msg);
    if (message) return message;
    return payload.success === false ? "The Worker reported an error." : "";
  }

  async function viaInstagram(link) {
    const paths = igPath ? [igPath] : IG_PATHS;
    let failure = "";

    for (const path of paths) {
      let payload;
      try {
        payload = await fetchJson(`${IG_WORKER}${path}?url=${encodeURIComponent(link)}`);
      } catch (error) {
        if (error.status === 404) continue; // wrong path: try the next one
        throw error;
      }

      const result = parseInstagram(payload, link);
      if (result) {
        igPath = path;
        return result;
      }

      const message = workerMessage(payload);
      if (message && !ROUTE_ERROR.test(message)) { failure = message; break; }
    }

    console.warn("ClearClip: the Instagram Worker answered, but no media was found in the response.");
    throw new Error(
      failure
        ? `The Instagram service replied: ${failure}`
        : "The Instagram service answered, but no video was found. Check that the post is public."
    );
  }

  // ---------- results ----------

  // Saves the file from inside the page so it lands in Downloads with a proper name.
  // If the host blocks that (CORS), open the file directly instead.
  async function saveAsFile(href, name, link) {
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
      const opened = window.open(href, "_blank");
      if (opened) opened.opener = null;
      else window.location.href = href;
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
      author.textContent = `@${meta.author}`;
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
        saveAsFile(href, entry.name, link);
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
