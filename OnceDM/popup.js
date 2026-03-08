(() => {
  const $ = (selector) => document.querySelector(selector);

  const toast = $("#toast");
  const toastMessage = $("#toast-msg");
  const statusIndicator = $("#status-indicator");
  const countBadge = $("#count-badge");
  const overlay = $("#overlay");
  const mediaGrid = $("#media-grid");
  const refreshButtons = ["#refresh-page-btn", "#header-refresh-btn"];
  const mediaMap = new Map();
  const params = new URLSearchParams(window.location.search);
  const desktopMode = params.get("desktop") === "1";
  const sourceTabId = Number(params.get("tabId")) || null;

  let activeTabId = null;
  let onDmPage = false;
  let scanTimer = null;

  function showToast(message, type = "success") {
    toastMessage.textContent = message;
    const icon = toast.querySelector("svg");
    icon.style.stroke = type === "error" ? "var(--danger)" : "var(--success)";
    toast.classList.add("show");
    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function setStatus(state, title) {
    statusIndicator.className = `status-indicator ${state}`;
    statusIndicator.title = title;
  }

  function normalizeText(value) {
    return value.replace(/\\\\/g, "").replace(/\\\//g, "/").replace(/\/+$/g, "").trim();
  }

  function getFilenameFromUrl(url) {
    let filename = url.split("/").pop()?.split("?")[0] || "download";
    try {
      filename = decodeURIComponent(filename);
    } catch (error) {
      void error;
    }

    if (/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i.test(filename)) {
      return filename;
    }

    return url.includes(".mp4") ? `${filename}.mp4` : `${filename}.jpeg`;
  }

  async function loadPreviewMedia(url, element) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      element.src = URL.createObjectURL(blob);
    } catch (error) {
      element.src = url;
    }
  }

  function createCard(name) {
    const { url, type } = mediaMap.get(name);
    const card = document.createElement("div");
    const preview = document.createElement(type === "video" ? "video" : "img");

    mediaGrid.querySelector(".empty-state")?.remove();
    mediaGrid.querySelector(".scanning-footer")?.remove();
    mediaGrid.querySelectorAll(".skeleton-card").forEach((element) => element.remove());

    card.className = "card";
    card.dataset.name = name;

    preview.draggable = false;
    preview.oncontextmenu = () => false;

    if (type === "video") {
      preview.muted = true;
      preview.playsInline = true;
      preview.loop = true;
      preview.autoplay = true;
    } else {
      preview.alt = "Media preview";
    }

    loadPreviewMedia(url, preview);
    card.appendChild(preview);
    card.insertAdjacentHTML(
      "beforeend",
      `
        <div class="card-overlay">
          <div class="card-actions">
            <span class="badge">${type}</span>
            <button class="btn-download" title="Download">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M19 12l-7 7-7-7"></path>
              </svg>
            </button>
          </div>
        </div>
      `
    );

    mediaGrid.prepend(card);
  }

  function renderEmptyState() {
    if (mediaMap.size > 0) {
      return;
    }

    if (onDmPage) {
      mediaGrid.innerHTML = `
        ${Array.from({ length: 4 }, () => '<div class="skeleton-card"></div>').join("")}
        <div class="scanning-footer">
          <div class="scanning-text">
            <div class="loading-spinner"></div>
            <span>Looking for media...</span>
          </div>
          <button id="refresh-page-btn" class="btn-refresh-small">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Refresh Page
          </button>
        </div>
      `;
      return;
    }

    mediaGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-blob"></div>
        <svg class="empty-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
    `;
  }

  function updateHeaderState() {
    const count = mediaMap.size;
    countBadge.textContent = `${count} item${count === 1 ? "" : "s"}`;
  }

  async function scanActiveTab() {
    try {
      const tab = sourceTabId
        ? await chrome.tabs.get(sourceTabId).catch(() => null)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

      if (!tab?.id) {
        return;
      }

      activeTabId = tab.id;
      onDmPage = tab.url?.includes("instagram.com/direct/t/") ?? false;

      if (!onDmPage) {
        setStatus("paused", "Open an Instagram DM thread");
        updateHeaderState();
        renderEmptyState();
        return;
      }

      setStatus("scanning", "Scanning active");

      const [{ result: pageHtml }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });

      const normalizedHtml = pageHtml
        .split("\n")
        .filter(Boolean)
        .map(normalizeText)
        .join("\n");

      // Keep the original narrow matcher so OnceDM only surfaces
      // the ephemeral "view once" media flow the first app detected.
      const mediaRegex = /https:\/\/video[^",\s]+/g;
      const existingUrls = new Set(Array.from(mediaMap.values()).map((item) => item.url));

      let match;
      let foundNewMedia = false;
      while ((match = mediaRegex.exec(normalizedHtml)) !== null) {
        const url = match[0].replace(/\\+$/g, "");
        if (existingUrls.has(url)) {
          continue;
        }

        const filename = getFilenameFromUrl(url);
        if (mediaMap.has(filename)) {
          continue;
        }

        mediaMap.set(filename, {
          url,
          type: url.includes(".mp4") ? "video" : "image",
        });
        existingUrls.add(url);
        createCard(filename);
        foundNewMedia = true;
      }

      if (foundNewMedia) {
        showToast("New media found");
      }

      updateHeaderState();
      renderEmptyState();
    } catch (error) {
      setStatus("paused", "Scan error");
      showToast("Unable to scan this page", "error");
    }
  }

  async function downloadSingle(url, filename) {
    chrome.runtime.sendMessage(
      { action: "DOWNLOAD_SINGLE", url, filename },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast("Download failed", "error");
          return;
        }

        const shortName = filename.length > 25 ? `${filename.slice(0, 25)}...` : filename;
        showToast(`Downloading ${shortName}`);
      }
    );
  }

  function openOverlay(card) {
    const media = card.querySelector("img, video");
    if (!media) {
      return;
    }

    overlay.innerHTML = "";
    const clone = media.cloneNode();
    clone.className = "";
    clone.draggable = false;
    clone.oncontextmenu = (event) => {
      event.preventDefault();
      return false;
    };

    if (clone.tagName === "VIDEO") {
      clone.controls = true;
      clone.muted = false;
      clone.autoplay = true;
      clone.loop = false;
    }

    overlay.appendChild(clone);
    overlay.classList.add("active");
  }

  function closeOverlay() {
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.innerHTML = "";
    }, 250);
  }

  function bindEvents() {
    document.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".card") || event.target.closest("#overlay")) {
        event.preventDefault();
      }
    });

    document.addEventListener("dragstart", (event) => {
      if (event.target.closest(".card")) {
        event.preventDefault();
      }
    });

    document.addEventListener("click", (event) => {
      const downloadButton = event.target.closest(".btn-download");
      if (downloadButton) {
        event.stopPropagation();
        const card = downloadButton.closest(".card");
        const entry = mediaMap.get(card.dataset.name);
        if (entry) {
          downloadSingle(entry.url, getFilenameFromUrl(entry.url));
        }
        return;
      }

      const card = event.target.closest(".card");
      if (card) {
        openOverlay(card);
        return;
      }

      if (event.target === overlay) {
        closeOverlay();
        return;
      }

      if (event.target.closest(refreshButtons.join(",")) && activeTabId) {
        chrome.tabs.reload(activeTabId);
      }
    });

    $("#theme-btn").onclick = () => {
      document.body.classList.toggle("light");
      localStorage.theme = document.body.classList.contains("light") ? "light" : "dark";
    };

    $("#zip-btn").onclick = () => {
      if (!mediaMap.size) {
        showToast("No media to zip", "error");
        return;
      }

      const files = Array.from(mediaMap.entries()).map(([filename, { url }]) => ({ filename, url }));
      showToast("Preparing ZIP in background...");
      chrome.runtime.sendMessage({ action: "DOWNLOAD_ZIP", files }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast("ZIP download failed", "error");
          return;
        }

        showToast("ZIP download started");
      });
    };
  }

  async function init() {
    if (localStorage.theme === "light") {
      document.body.classList.add("light");
    }

    if (desktopMode) {
      document.body.classList.add("desktop");
    }

    const version = $("#app-version");
    if (version) {
      version.textContent = "v1.1.0";
    }

    updateHeaderState();
    renderEmptyState();
    bindEvents();
    await scanActiveTab();
    scanTimer = setInterval(scanActiveTab, 3000);
  }

  window.addEventListener("unload", () => {
    if (scanTimer) {
      clearInterval(scanTimer);
    }
  });

  init();
})();
