(() => {
  const BADGE_ID = "oncedm-inbox-badge";
  const INBOX_PATH = "/direct/inbox/";
  const THREAD_PATH = /^\/direct\/t\/[^/]+\/?$/;

  function shouldShowBadge() {
    return window.location.pathname === INBOX_PATH || THREAD_PATH.test(window.location.pathname);
  }

  function removeBadge() {
    document.getElementById(BADGE_ID)?.remove();
  }

  function ensureBadge() {
    if (!shouldShowBadge()) {
      removeBadge();
      return;
    }

    const existing = document.getElementById(BADGE_ID);
    if (existing) {
      return;
    }

    const badge = document.createElement("div");
    const icon = document.createElement("img");
    badge.id = BADGE_ID;
    icon.src = chrome.runtime.getURL("icon.png");
    icon.alt = "OnceDM";
    badge.appendChild(icon);
    badge.title = "Open OnceDM desktop view";
    badge.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_DESKTOP_VIEW" });
    });
    document.body.appendChild(badge);
  }

  const style = document.createElement("style");
  style.textContent = `
    #${BADGE_ID} {
      position: fixed;
      left: 18px;
      bottom: 18px;
      transform: none;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(12px);
      z-index: 2147483647;
      pointer-events: auto;
      cursor: pointer;
    }

    #${BADGE_ID} img {
      width: 24px;
      height: 24px;
      display: block;
    }
  `;

  document.documentElement.appendChild(style);

  let lastPath = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      ensureBadge();
    }
  }, 500);

  new MutationObserver(() => {
    ensureBadge();
  }).observe(document.documentElement, { childList: true, subtree: true });

  ensureBadge();
})();
