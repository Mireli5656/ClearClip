/* ClearClip: script.js
   Vanilla JavaScript, no dependencies, no build step. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------- storage (never throws) ----------
  const store = {
    get(key) {
      try { return localStorage.getItem(key) || ""; } catch { return ""; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    }
  };

  // ---------- helpers ----------
  const PLATFORMS = [
    ["tiktok.com", "TikTok"],
    ["instagram.com", "Instagram"],
    ["snapchat.com", "Snapchat"],
    ["facebook.com", "Facebook"],
    ["fb.watch", "Facebook"],
    ["fb.com", "Facebook"]
  ];

  const withScheme = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

  function detect(link) {
    let host;
    try { host = new URL(link).hostname.toLowerCase(); } catch { return null; }
    for (const [domain, name] of PLATFORMS) {
      if (host === domain || host.endsWith(`.${domain}`)) return name;
    }
    return null;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch { return null; }
  }

  function normalizeApi(value) {
    const v = (value || "").trim().replace(/\/+$/, "");
    return v ? withScheme(v) : "";
  }

  const DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

  // ---------- elements ----------
  const frame = $("frame");
  const linkInput = $("link");
  const goButton = $("go");
  const statusEl = $("status");
  const resultEl = $("result");
  const pill = $("pill");
  const settings = $("settings");
  const gear = $("openSettings");

  let busy = false;

  // ---------- UI state ----------
  function setStatus(message, kind = "", action = null) {
    statusEl.className = `status ${kind}`.trim();
    statusEl.replaceChildren(document.createTextNode(message || ""));
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "linkbtn";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      statusEl.append(" ", button);
    }
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
    const raw = linkInput.value.trim();
    if (!raw) {
      pill.dataset.state = "idle";
      pill.textContent = "Paste a link";
      return;
    }
    const platform = detect(withScheme(raw));
    pill.dataset.state = platform ? "ok" : "bad";
    pill.textContent = platform ? `${platform} link` : "Unsupported link";
  }

  function refreshGear() {
    gear.classList.toggle("on", Boolean(normalizeApi(store.get("cc_api"))));
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
        "Couldn't reach the service. Check your connection, and make sure the instance allows requests from this site (CORS)."
      );
    } finally {
      clearTimeout(timer);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`The service sent an unexpected response (HTTP ${response.status}).`);
    }
  }

  const COBALT_ERRORS = [
    ["content.post.private", "This video is private. Only public videos can be saved."],
    ["unavailable", "This video isn't available. It may have been deleted."],
    ["link.invalid", "This link isn't valid. Copy it again from the app."],
    ["link.unsupported", "This instance doesn't support this link."],
    ["rate_exceeded", "Too many requests. Wait a minute, then try again."],
    ["fetch.fail", "The instance couldn't fetch this video. The platform may be blocking it; try again later."],
    ["auth", "This instance needs an API key. Add it in Connection settings."]
  ];

  function explainCobalt(code) {
    const text = String(code || "");
    for (const [needle, message] of COBALT_ERRORS) {
      if (text.includes(needle)) return message;
    }
    return `The instance returned an error${text ? ` (${text})` : ""}.`;
  }

  async function viaCobalt(base, link, quality) {
    const headers = { "Accept": "application/json", "Content-Type": "application/json" };
    const key = store.get("cc_key").trim();
    if (key) headers.Authorization = `Api-Key ${key}`;

    const data = await fetchJson(`${base}/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: link,
        videoQuality: quality,
        downloadMode: "auto",
        filenameStyle: "basic"
      })
    });

    if (!data) throw new Error("The instance sent an empty response.");

    if (data.status === "tunnel" || data.status === "redirect") {
      return { items: [{ label: "Download video", url: data.url, name: data.filename }], meta: null };
    }
    if (data.status === "picker" && Array.isArray(data.picker)) {
      return {
        items: data.picker.map((entry, index) => ({
          label: `Download ${entry.type === "photo" ? "photo" : "video"} ${index + 1}`,
          url: entry.url
        })),
        meta: null
      };
    }
    if (data.status === "error") {
      throw new Error(explainCobalt(data.error && data.error.code));
    }
    throw new Error(`This instance returned a response ClearClip can't use (${data.status}).`);
  }

  async function viaTikwm(link, retried = false) {
    // Use the www host: tikwm.com redirects to www, and a redirect breaks the CORS check in browsers.
    const data = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(link)}&hd=1`);
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
    const absolute = (u) => (u && u.startsWith("/") ? `https://www.tikwm.com${u}` : u);
    const d = data.data;
    const hd = absolute(d.hdplay);
    const sd = absolute(d.play);
    const music = absolute(typeof d.music === "string" ? d.music : d.music_info && d.music_info.play);
    const id = String(d.id || "video").replace(/[^\w-]/g, "");

    const items = [];
    if (hd) items.push({ label: "Download HD video", url: hd, name: `clearclip_${id}_hd.mp4`, blob: true });
    if (sd && sd !== hd) items.push({ label: "Download standard video", url: sd, name: `clearclip_${id}.mp4`, blob: true });
    if (!items.length) throw new Error("No watermark-free version was found for this video.");
    if (music) items.push({ label: "Download MP3 audio", url: music, name: `clearclip_${id}.mp3`, blob: true });

    const meta = {
      cover: absolute(d.cover),
      title: d.title || "",
      author: (d.author && d.author.unique_id) || ""
    };
    return { items, meta };
  }

  // ---------- results ----------
  // Saves the file from inside the page so it lands in Downloads with a proper name.
  // If the host blocks that (CORS), fall back to opening the file directly.
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
      window.location.href = href;
    } finally {
      label.textContent = original;
      delete link.dataset.busy;
    }
  }

  function buildMeta(meta) {
    const card = document.createElement("div");
    card.className = "meta";

    const cover = safeUrl(meta.cover);
    if (cover) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = cover;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      card.append(img);
    }

    const text = document.createElement("div");
    text.className = "meta-text";
    const title = document.createElement("div");
    title.className = "meta-title";
    title.textContent = meta.title ? meta.title.slice(0, 90) : "TikTok video"; // textContent: never HTML
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

  function showItems(items, platform, meta) {
    resultEl.replaceChildren();
    if (meta && (meta.title || meta.author || meta.cover)) resultEl.append(buildMeta(meta));
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
      if (entry.name) link.download = entry.name;
      if (entry.blob) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          saveAsFile(href, entry.name, link);
        });
      }
      link.insertAdjacentHTML("afterbegin", DOWNLOAD_ICON); // static markup only
      link.append(document.createTextNode(entry.label));

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
      setStatus("The service didn't return a download link. Try again.", "err");
      return;
    }
    frame.classList.add("is-clear");
    setStatus(`Ready. Your ${platform} video has no watermark.`, "ok");
  }

  // ---------- main flow ----------
  async function run(event) {
    event.preventDefault();
    if (busy) return;
    resetResult();

    let link = linkInput.value.trim();
    if (!link) {
      setStatus("Paste a video link first.", "err");
      linkInput.focus();
      return;
    }
    link = withScheme(link);

    const platform = detect(link);
    if (!platform) {
      setStatus("This link isn't supported. Use a link from TikTok, Instagram, Snapchat or Facebook.", "err");
      return;
    }

    const quality = document.querySelector('input[name="q"]:checked').value;
    const api = normalizeApi(store.get("cc_api"));

    setBusy(true);
    setStatus(`Getting your ${platform} video…`);

    try {
      let result;
      if (api) {
        try {
          result = await viaCobalt(api, link, quality);
        } catch (error) {
          if (platform !== "TikTok") throw error;
          try { result = await viaTikwm(link); } catch { throw error; }
        }
      } else if (platform === "TikTok") {
        result = await viaTikwm(link);
      } else {
        setStatus(`${platform} needs a Cobalt API address.`, "err", {
          label: "Open settings",
          onClick: openSettings
        });
        return;
      }
      showItems(result.items, platform, result.meta);
    } catch (error) {
      setStatus(error.message || "Something went wrong. Try again.", "err");
    } finally {
      setBusy(false);
    }
  }

  // ---------- settings sheet ----------
  function showSettingsError(message) {
    const el = $("settingsError");
    el.textContent = message || "";
    el.hidden = !message;
  }

  function openSettings() {
    $("api").value = store.get("cc_api");
    $("key").value = store.get("cc_key");
    showSettingsError("");
    if (!settings.open) settings.showModal();
    $("api").focus();
  }

  $("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const api = normalizeApi($("api").value);
    if (api && !/^https:\/\//i.test(api)) {
      showSettingsError("Use an address that starts with https://. This site can't call plain http addresses.");
      return;
    }
    try { new URL(api || "https://x"); } catch {
      showSettingsError("That doesn't look like a valid address.");
      return;
    }
    store.set("cc_api", api);
    store.set("cc_key", $("key").value.trim());
    refreshGear();
    settings.close();
    setStatus(api ? "Settings saved." : "No instance set. Only TikTok links will work.", "ok");
  });

  $("cancel").addEventListener("click", () => settings.close());

  $("forget").addEventListener("click", () => {
    store.set("cc_api", "");
    store.set("cc_key", "");
    $("api").value = "";
    $("key").value = "";
    refreshGear();
    settings.close();
    setStatus("Saved settings removed.", "ok");
  });

  settings.addEventListener("click", (event) => {
    if (event.target === settings) settings.close(); // tap on the backdrop
  });

  gear.addEventListener("click", openSettings);

  // ---------- wire up ----------
  $("form").addEventListener("submit", run);

  linkInput.addEventListener("input", () => {
    updatePill();
    resetResult();
  });

  $("paste").addEventListener("click", async () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setStatus("This browser can't read the clipboard. Paste the link into the field instead.", "err");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      linkInput.value = (text || "").trim();
      updatePill();
      resetResult();
      linkInput.focus();
    } catch {
      setStatus("Clipboard access was denied. Paste the link into the field instead.", "err");
    }
  });

  document.querySelectorAll('input[name="q"]').forEach((radio) => {
    radio.addEventListener("change", () => store.set("cc_quality", radio.value));
  });

  const savedQuality = store.get("cc_quality");
  const savedRadio = savedQuality && document.querySelector(`input[name="q"][value="${savedQuality}"]`);
  if (savedRadio) savedRadio.checked = true;

  refreshGear();
  updatePill();
})();
