(() => {
  if (window.__venpper) return;
  window.__venpper = true;

  // Yapper keeps at most 5 saved logins: savedAccounts writes
  // accounts.slice(0, 5). Keep every account this browser has signed into.
  const slice = Array.prototype.slice;
  Array.prototype.slice = function (...args) {
    const row = this && this.length > 5 ? this[0] : null;
    if (
      args.length === 2 &&
      args[0] === 0 &&
      args[1] === 5 &&
      row &&
      typeof row === "object" &&
      typeof row.userId === "string" &&
      typeof row.refresh_token === "string"
    ) {
      return slice.call(this);
    }
    return slice.apply(this, args);
  };

  const SETTINGS_KEY = "venpper-settings";
  const DEFAULTS = {
    readAll: true,
    deleted: true,
    privacy: true,
    usernames: true,
    fakePlus: false,
    streamer: false,
  };
  const PLUS_MARK = "\u2060";

  const settings = loadSettings();
  let unblurred = false;
  let labelToken = 0;
  let scheduled = false;
  let captured = null;

  const cache = new Map();
  const deleted = new Map();
  let storeRef = null;
  let plusSyncing = false;
  let plusSyncTries = 0;
  let plusSyncAt = 0;
  let syncedPlus = null;
  const refreshedAt = new Map();
  let channelKey = "";
  let tryingNames = false;
  let tryCancel = false;

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    remember(input, init);
    return origFetch(input, init);
  };

  const style = document.createElement("style");
  style.id = "venpper-style";
  style.textContent = `
    #venpper-launcher {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 2147483000;
      border: 0;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      padding: 0;
      background: #5865f2;
      color: #fff;
      font: 700 14px/1 Inter, system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    #venpper-launcher.docked {
      position: static;
      width: 32px;
      height: 32px;
      margin-left: 4px;
      box-shadow: none;
      flex: 0 0 auto;
    }
    #venpper-launcher:hover { filter: brightness(1.08); }
    #venpper-panel {
      position: fixed;
      top: 52px;
      right: 12px;
      z-index: 2147483000;
      width: 320px;
      max-height: calc(100vh - 72px);
      overflow: auto;
      padding: 14px;
      border-radius: 12px;
      background: #1e1f22;
      color: #f2f3f5;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      font: 14px/1.4 Inter, system-ui, sans-serif;
    }
    #venpper-panel.docked {
      top: auto;
      right: auto;
      bottom: 64px;
      left: 76px;
    }
    #venpper-panel[hidden] { display: none; }
    #venpper-panel h2 {
      margin: 0 0 4px;
      font-size: 16px;
    }
    #venpper-panel .hint {
      margin: 0 0 12px;
      color: #b5bac1;
      font-size: 12px;
    }
    #venpper-panel label.row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 8px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      cursor: pointer;
    }
    #venpper-panel label.row input { margin-top: 3px; }
    #venpper-panel .name { font-weight: 700; }
    #venpper-panel .desc { color: #b5bac1; font-size: 12px; }
    #venpper-names {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    #venpper-names .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
    #venpper-names input[type="number"] {
      width: 72px;
      border: 0;
      border-radius: 6px;
      padding: 6px 8px;
      background: #111214;
      color: inherit;
    }
    #venpper-names button, #venpper-unblur, #venpper-read-all {
      border: 0;
      border-radius: 8px;
      background: #5865f2;
      color: #fff;
      font: 700 12px/1 Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    #venpper-names button { padding: 8px 10px; }
    #venpper-results { display: grid; gap: 6px; margin-top: 8px; }
    #venpper-results button {
      text-align: left;
      background: #2b2d31;
      font-family: ui-monospace, Consolas, monospace;
      font-weight: 600;
    }
    #venpper-names .error { color: #f23f43; font-size: 12px; min-height: 1em; }
    #venpper-try-status { color: #b5bac1; font-size: 12px; min-height: 1em; margin-top: 6px; }
    #venpper-try-status.bad { color: #f23f43; }
    #venpper-try-status.good { color: #23a559; }
    #venpper-read-all {
      position: fixed;
      z-index: 20;
      width: 48px;
      height: 48px;
      padding: 4px;
      border-radius: 24px;
      background: var(--bg-elev, #1e1f22);
      color: var(--text, #f2f3f5);
      letter-spacing: 0.01em;
      text-align: center;
      white-space: pre-line;
    }
    #venpper-read-all:hover:not(:disabled) {
      background: var(--accent, #5865f2);
      color: #fff;
      border-radius: 16px;
    }
    #venpper-read-all:disabled { cursor: wait; opacity: 0.75; }
    .msg.venpper-deleted { background: rgba(242, 63, 67, 0.12); }
    .msg.venpper-deleted .msg-text,
    .msg.venpper-deleted .venpper-deleted-tag {
      color: #f23f43;
    }
    .venpper-deleted-tag {
      margin-left: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .settings-main.venpper-blurred { position: relative; }
    .settings-main.venpper-blurred > :not(#venpper-unblur):not(.settings-close) {
      filter: blur(16px);
      user-select: none;
      pointer-events: none;
    }
    #venpper-unblur {
      position: absolute;
      left: 50%;
      top: 38%;
      transform: translate(-50%, -50%);
      z-index: 5;
      padding: 12px 18px;
      font-size: 14px;
    }
    .plus-badge[data-venpper-plus] {
      vertical-align: 1px;
      letter-spacing: 0.06em;
      color: #fff;
      background: linear-gradient(135deg, #ff6b4a, #9b59ff);
      border-radius: 4px;
      margin-left: 4px;
      padding: 1px 5px;
      font-size: 9px;
      font-weight: 800;
      display: inline-block;
    }
    .pc2-custom.venpper-mark-only,
    .pick-row-sub.venpper-mark-only,
    .user-bar .status.venpper-mark-only {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const launcher = document.createElement("button");
  launcher.id = "venpper-launcher";
  launcher.type = "button";
  launcher.textContent = "V";
  launcher.title = "Venpper";
  launcher.setAttribute("aria-label", "Venpper");
  document.documentElement.appendChild(launcher);

  const panel = document.createElement("aside");
  panel.id = "venpper-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Venpper</h2>
    <p class="hint">Turn mods on or off. They stay on this computer.</p>
    <label class="row">
      <input type="checkbox" data-mod="readAll">
      <span><span class="name">Read All</span><br><span class="desc">Marks every unread channel and mention as read.</span></span>
    </label>
    <label class="row">
      <input type="checkbox" data-mod="deleted">
      <span><span class="name">Deleted messages</span><br><span class="desc">Keeps messages you already saw, and shows them in red after they are deleted.</span></span>
    </label>
    <label class="row">
      <input type="checkbox" data-mod="privacy">
      <span><span class="name">Privacy</span><br><span class="desc">Blurs My Account until you press Unblur.</span></span>
    </label>
    <label class="row">
      <input type="checkbox" data-mod="usernames">
      <span><span class="name">Username generator</span><br><span class="desc">Builds random names, or tries every 2-character name made of numbers, dots, and underscores and sets the first free one.</span></span>
    </label>
    <label class="row">
      <input type="checkbox" data-mod="fakePlus">
      <span><span class="name">FakeYapPlus</span><br><span class="desc">Shows a PLUS badge beside your name. Other people using Venpper see it too.</span></span>
    </label>
    <label class="row">
      <input type="checkbox" data-mod="streamer">
      <span><span class="name">Streamer mode</span><br><span class="desc">Hides your full username and the full usernames of people you have added.</span></span>
    </label>
    <section id="venpper-names">
      <div class="controls">
        <label>Characters <input id="venpper-length" type="number" min="1" max="32" value="8"></label>
        <label><input id="venpper-letters" type="checkbox" checked> Letters</label>
        <label><input id="venpper-numbers" type="checkbox" checked> Numbers</label>
        <button type="button" id="venpper-generate">Generate</button>
        <button type="button" id="venpper-try">Try 2-character names</button>
      </div>
      <div class="error" id="venpper-name-error"></div>
      <div id="venpper-try-status"></div>
      <div id="venpper-results"></div>
    </section>
  `;
  document.documentElement.appendChild(panel);

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function syncPanel() {
    panel.querySelectorAll("[data-mod]").forEach((input) => {
      input.checked = !!settings[input.dataset.mod];
    });
    panel.querySelector("#venpper-names").hidden = !settings.usernames;
  }

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  panel.addEventListener("change", (event) => {
    const input = event.target.closest("[data-mod]");
    if (!input) return;
    settings[input.dataset.mod] = input.checked;
    saveSettings();
    syncPanel();
    applyMods();
  });

  panel.querySelector("#venpper-generate").addEventListener("click", generateNames);
  panel.querySelector("#venpper-try").addEventListener("click", (event) => {
    tryShortNames(event.currentTarget);
  });
  panel.addEventListener("click", (event) => {
    const result = event.target.closest("[data-copy]");
    if (!result) return;
    const value = result.dataset.copy;
    navigator.clipboard?.writeText(value).then(
      () => {
        result.textContent = "Copied " + value;
      },
      () => {
        result.textContent = value;
      }
    );
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") panel.hidden = true;
  });

  function remember(input, init) {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url;
      if (!url || !url.includes("/rest/v1/")) return;
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      );
      const apikey = headers.get("apikey");
      const authorization = headers.get("authorization");
      if (!apikey || !authorization) return;
      captured = { base: url.split("/rest/v1/")[0], apikey, authorization };
    } catch {
      /* ignore malformed requests */
    }
  }

  async function rpc(name, body) {
    if (!captured) {
      throw new Error("Yapper is still connecting. Try again in a second.");
    }
    const res = await origFetch(`${captured.base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: captured.apikey,
        authorization: captured.authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    if (!res.ok) {
      const message =
        (data && (data.message || data.error || data.hint)) ||
        `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function storeFromFiber(fiber) {
    let hook = fiber?.memoizedState;
    for (let i = 0; hook && i < 80; i += 1, hook = hook.next) {
      const state = hook.memoizedState;
      if (!Array.isArray(state) || !Array.isArray(state[1])) continue;
      for (const dep of state[1]) {
        if (!dep || typeof dep.getState !== "function" || typeof dep.setState !== "function") {
          continue;
        }
        try {
          const snap = dep.getState();
          if (
            snap &&
            typeof snap.unread === "object" &&
            snap.unread &&
            typeof snap.servers === "object" &&
            snap.servers &&
            typeof snap.channels === "object"
          ) {
            return dep;
          }
        } catch {
          /* not this store */
        }
      }
    }
    return null;
  }

  function fiberOf(node) {
    if (!node) return null;
    const key = Object.keys(node).find(
      (name) =>
        name.startsWith("__reactFiber$") ||
        name.startsWith("__reactInternalInstance$") ||
        name.startsWith("__reactContainer$")
    );
    const value = key ? node[key] : null;
    if (value && value.current && typeof value.current === "object" && !("memoizedState" in value)) {
      return value.current;
    }
    return value;
  }

  function findStore(start) {
    const seen = new Set();
    let fiber = fiberOf(start);
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      const found = storeFromFiber(fiber);
      if (found) return found;
      fiber = fiber.return;
    }
    const root = fiberOf(document.getElementById("__next")) || fiberOf(document.body);
    const stack = root ? [root] : [];
    let budget = 2500;
    while (stack.length && budget > 0) {
      const next = stack.pop();
      budget -= 1;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      const found = storeFromFiber(next);
      if (found) return found;
      if (next.sibling) stack.push(next.sibling);
      if (next.child) stack.push(next.child);
    }
    return null;
  }

  function setLabel(button, text, title) {
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
  }

  async function markChannels(ids) {
    const pending = [...ids];
    const failed = [];
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length) {
        const id = pending[cursor];
        cursor += 1;
        try {
          await rpc("mark_read", { cid: id });
        } catch {
          failed.push(id);
        }
      }
    }
    const limit = Math.min(4, pending.length);
    if (limit > 0) await Promise.all(Array.from({ length: limit }, () => worker()));
    const stillFailed = [];
    for (const id of failed) {
      try {
        await rpc("mark_read", { cid: id });
      } catch {
        stillFailed.push(id);
      }
    }
    return stillFailed;
  }

  async function readAll(button) {
    if (button.dataset.busy === "1") return;
    labelToken += 1;
    button.dataset.busy = "1";
    button.disabled = true;
    setLabel(button, "…", "Marking everything as read");
    const rail = document.querySelector("nav.rail");
    const store = rail ? findStore(rail) : null;
    const snap = store ? store.getState() : null;
    const ids = new Set([
      ...Object.keys(snap?.unread || {}),
      ...Object.keys(snap?.mentions || {}),
    ]);
    try {
      try {
        const rows = await rpc("unread_counts_v2", {});
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row?.channel_id && (row.unread || row.mentions)) ids.add(row.channel_id);
        }
      } catch (error) {
        if (ids.size === 0) throw error;
      }
      if (store) store.setState({ unread: {}, mentions: {} });
      const failed = await markChannels(ids);
      if (failed.length) {
        throw new Error(
          `Marked ${ids.size - failed.length} of ${ids.size}. ${failed.length} still unread.`
        );
      }
      const title =
        ids.size === 0
          ? "Nothing unread"
          : `Marked ${ids.size} channel${ids.size === 1 ? "" : "s"} as read`;
      const token = ++labelToken;
      setLabel(button, "Done", title);
      window.setTimeout(() => {
        if (token !== labelToken || button.dataset.busy === "1") return;
        setLabel(button, "Read\nall", "Mark every unread channel as read");
      }, 1400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not mark everything as read";
      setLabel(button, "Retry", message);
    } finally {
      button.disabled = false;
      button.dataset.busy = "0";
    }
  }

  function placeReadAll() {
    let button = document.getElementById("venpper-read-all");
    if (!button) {
      button = document.createElement("button");
      button.id = "venpper-read-all";
      button.type = "button";
      button.hidden = true;
      setLabel(button, "Read\nall", "Mark every unread channel as read");
      button.addEventListener("click", () => readAll(button));
      document.documentElement.appendChild(button);
    }
    const rail = document.querySelector("nav.rail");
    if (!rail) {
      button.hidden = true;
      return;
    }
    const inline = parseFloat(rail.style.paddingTop);
    if (!(rail.__venpperReadAllApplied === true && inline > 0)) {
      const base =
        typeof rail.__venpperReadAllBase === "number"
          ? rail.__venpperReadAllBase
          : parseFloat(getComputedStyle(rail).paddingTop) || 0;
      rail.__venpperReadAllBase = base;
      rail.__venpperReadAllApplied = true;
      rail.style.paddingTop = `${base + 64}px`;
    }
    const rect = rail.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.style.left = `${rect.left + (rect.width - 48) / 2}px`;
    button.style.top = `${rect.top + (rail.__venpperReadAllBase || 0) + 8}px`;
  }

  function stopReadAll() {
    document.getElementById("venpper-read-all")?.remove();
    const rail = document.querySelector("nav.rail");
    if (rail && rail.__venpperReadAllApplied) {
      rail.style.paddingTop = `${rail.__venpperReadAllBase || 0}px`;
      rail.__venpperReadAllApplied = false;
    }
  }

  function currentChannel() {
    return (document.querySelector(".title-btn")?.textContent || "").trim();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
    );
  }

  function messageParent() {
    return document.querySelector(".messages .msg")?.parentElement || document.querySelector(".messages");
  }

  function deletedTick() {
    const nextChannel = currentChannel();
    if (nextChannel !== channelKey) {
      channelKey = nextChannel;
      cache.clear();
      deleted.clear();
      document.querySelectorAll("[data-venpper-deleted]").forEach((node) => node.remove());
    }

    const nodes = [
      ...document.querySelectorAll(".messages .msg[data-message-id]:not([data-venpper-deleted])"),
    ];
    if (nodes.length === 0) return;

    const present = new Set();
    let prev = null;
    for (const node of nodes) {
      const id = node.dataset.messageId;
      if (!id) continue;
      present.add(id);
      const previous = cache.get(id) || {};
      if (prev) {
        const prevMeta = cache.get(prev);
        if (prevMeta) prevMeta.next = id;
      }
      cache.set(id, {
        ...previous,
        id,
        prev,
        author: node.querySelector(".msg-author")?.textContent?.trim() || "Someone",
        time: node.querySelector(".msg-time")?.textContent?.trim() || "",
        text: node.querySelector(".msg-text")?.innerText?.trim() || "",
      });
      if (deleted.has(id)) deleted.delete(id);
      prev = id;
    }

    for (const [id, meta] of cache) {
      if (present.has(id) || deleted.has(id)) continue;
      const prevStill = meta.prev && (present.has(meta.prev) || deleted.has(meta.prev));
      const nextStill = meta.next && (present.has(meta.next) || deleted.has(meta.next));
      if (prevStill || nextStill) deleted.set(id, meta);
    }
    for (const [id, meta] of cache) {
      if (present.has(id) || deleted.has(id)) continue;
      const prevStill = meta.prev && (present.has(meta.prev) || deleted.has(meta.prev));
      const nextStill = meta.next && (present.has(meta.next) || deleted.has(meta.next));
      if (prevStill || nextStill) deleted.set(id, meta);
    }

    document.querySelectorAll("[data-venpper-deleted]").forEach((node) => {
      if (!deleted.has(node.dataset.messageId)) node.remove();
    });

    const parent = messageParent();
    if (!parent) return;
    for (const [id, meta] of deleted) {
      if (parent.querySelector(`[data-venpper-deleted][data-message-id="${CSS.escape(id)}"]`)) continue;
      const row = document.createElement("div");
      row.className = "msg venpper-deleted";
      row.dataset.messageId = id;
      row.dataset.venpperDeleted = "1";
      row.innerHTML = `
        <div class="msg-gutter"></div>
        <div class="msg-body">
          <div class="msg-head">
            <span class="msg-author">${escapeHtml(meta.author)}</span>
            <span class="msg-time">${escapeHtml(meta.time)}</span>
            <span class="venpper-deleted-tag">deleted</span>
          </div>
          <div class="msg-text">${escapeHtml(meta.text)}</div>
        </div>
      `;
      const anchorId = meta.prev && (present.has(meta.prev) || deleted.has(meta.prev)) ? meta.prev : meta.next;
      const anchor = anchorId
        ? parent.querySelector(`.msg[data-message-id="${CSS.escape(anchorId)}"]`)
        : null;
      if (anchor && anchor.dataset.messageId === meta.prev) anchor.after(row);
      else if (anchor) anchor.before(row);
      else parent.appendChild(row);
    }
  }

  function stopDeleted() {
    cache.clear();
    deleted.clear();
    channelKey = "";
    document.querySelectorAll("[data-venpper-deleted]").forEach((node) => node.remove());
  }

  function accountButton() {
    return [...document.querySelectorAll(".settings-nav button")].find(
      (button) => button.textContent.trim() === "My Account"
    );
  }

  function clearBlur() {
    document.querySelector(".settings-main")?.classList.remove("venpper-blurred");
    document.getElementById("venpper-unblur")?.remove();
  }

  function privacyTick() {
    const button = accountButton();
    const open = !!(button && button.classList.contains("active"));
    if (!open) {
      unblurred = false;
      clearBlur();
      return;
    }
    if (unblurred) {
      clearBlur();
      return;
    }
    const main = document.querySelector(".settings-main");
    if (!main) return;
    main.classList.add("venpper-blurred");
    if (!document.getElementById("venpper-unblur")) {
      const unblur = document.createElement("button");
      unblur.id = "venpper-unblur";
      unblur.type = "button";
      unblur.textContent = "Unblur";
      unblur.addEventListener("click", () => {
        unblurred = true;
        clearBlur();
      });
      main.appendChild(unblur);
    }
  }

  function generateNames() {
    const error = panel.querySelector("#venpper-name-error");
    const results = panel.querySelector("#venpper-results");
    const length = Number(panel.querySelector("#venpper-length").value);
    const letters = panel.querySelector("#venpper-letters").checked;
    const numbers = panel.querySelector("#venpper-numbers").checked;
    results.innerHTML = "";
    if (!Number.isInteger(length) || length < 1 || length > 32) {
      error.textContent = "Pick a length from 1 to 32.";
      return;
    }
    if (!letters && !numbers) {
      error.textContent = "Turn on letters, numbers, or both.";
      return;
    }
    error.textContent = "";
    let alphabet = "";
    if (letters) alphabet += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (numbers) alphabet += "0123456789";
    for (let n = 0; n < 6; n += 1) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      let name = "";
      for (let i = 0; i < length; i += 1) name += alphabet[bytes[i] % alphabet.length];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.copy = name;
      button.textContent = name;
      button.title = "Copy";
      results.appendChild(button);
    }
  }

  function twoCharNames() {
    const alphabet = "0123456789._";
    const names = [];
    for (const first of alphabet) {
      for (const second of alphabet) names.push(first + second);
    }
    return names;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function setTryStatus(text, kind) {
    const status = panel.querySelector("#venpper-try-status");
    status.textContent = text;
    status.classList.toggle("bad", kind === "bad");
    status.classList.toggle("good", kind === "good");
  }

  function nameWasTaken(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /taken|profiles_username|duplicate key|already exists/i.test(message) || error?.status === 409;
  }

  async function usernameIsTaken(name) {
    return !!(await rpc("username_taken", { name }));
  }

  async function setUsername(name) {
    const store = getStore();
    const id = store?.getState?.().userId;
    if (!captured || !id) {
      throw new Error("Yapper is still connecting. Try again in a second.");
    }
    const res = await origFetch(
      `${captured.base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          ...restHeaders("return=representation"),
          "content-profile": "public",
        },
        body: JSON.stringify({ username: name }),
      }
    );
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    if (!res.ok) {
      const message =
        (data && (data.message || data.error || data.hint || data.details)) ||
        `Request failed (${res.status})`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    rememberProfile(id, row || { username: name });
  }

  async function tryShortNames(button) {
    if (tryingNames) {
      tryCancel = true;
      button.disabled = true;
      setTryStatus("Stopping…");
      return;
    }
    const names = twoCharNames();
    tryingNames = true;
    tryCancel = false;
    button.textContent = "Stop";
    let checkWorks = true;
    try {
      for (let i = 0; i < names.length; i += 1) {
        if (tryCancel) {
          setTryStatus("Stopped. Your username was not changed.");
          return;
        }
        const name = names[i];
        setTryStatus(`Trying ${i + 1} of ${names.length}: ${name}`);
        let taken = false;
        if (checkWorks) {
          try {
            taken = await usernameIsTaken(name);
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/404|could not find|function/i.test(message)) {
              checkWorks = false;
            } else {
              throw error;
            }
          }
        }
        if (!taken && !tryCancel) {
          try {
            await setUsername(name);
            setTryStatus(`Set your username to ${name}.`, "good");
            return;
          } catch (error) {
            if (!nameWasTaken(error)) throw error;
          }
        }
        await sleep(80);
      }
      setTryStatus(`None of those ${names.length} names were free.`, "bad");
    } catch (error) {
      setTryStatus(error instanceof Error ? error.message : "Could not try those names.", "bad");
    } finally {
      tryingNames = false;
      tryCancel = false;
      button.disabled = false;
      button.textContent = "Try 2-character names";
    }
  }

  function getStore() {
    try {
      if (storeRef && storeRef.getState().servers) return storeRef;
    } catch {
      storeRef = null;
    }
    const start = document.querySelector("nav.rail") || document.querySelector(".user-bar") || document.body;
    storeRef = findStore(start);
    return storeRef;
  }

  function cleanPlusName(value) {
    return String(value || "").replaceAll(PLUS_MARK, "").trim();
  }

  function profileMarked(profile) {
    if (!profile) return false;
    return ["display_name", "custom_status", "bio"].some(
      (key) => typeof profile[key] === "string" && profile[key].includes(PLUS_MARK)
    );
  }

  function restHeaders(prefer) {
    const headers = {
      apikey: captured.apikey,
      authorization: captured.authorization,
      accept: "application/json",
      "accept-profile": "public",
    };
    if (prefer) {
      headers["content-type"] = "application/json";
      headers.prefer = prefer;
    }
    return headers;
  }

  async function patchProfile(id, fields) {
    if (!captured) return false;
    const res = await origFetch(`${captured.base}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        ...restHeaders("return=minimal"),
        "content-profile": "public",
        "accept-profile": "public",
      },
      body: JSON.stringify(fields),
    });
    return res.ok;
  }

  function rememberProfile(id, row) {
    const store = getStore();
    if (!store || !row) return;
    store.setState((state) => ({
      profiles: {
        ...state.profiles,
        [id]: { ...state.profiles[id], ...row },
      },
    }));
  }

  async function syncFakePlus() {
    if (plusSyncing) return;
    const store = getStore();
    if (!store || !captured) {
      if (settings.fakePlus && plusSyncTries < 8) {
        plusSyncTries += 1;
        window.setTimeout(syncFakePlus, 1000);
      }
      return;
    }
    const snap = store.getState();
    const id = snap.userId;
    const me = id && snap.profiles?.[id];
    if (!me) {
      if (settings.fakePlus && plusSyncTries < 8) {
        plusSyncTries += 1;
        window.setTimeout(syncFakePlus, 1000);
      }
      return;
    }
    const status = typeof me.custom_status === "string" ? me.custom_status : "";
    const has = status.includes(PLUS_MARK);
    if (settings.fakePlus === has && syncedPlus === settings.fakePlus) return;
    if (Date.now() - plusSyncAt < 3000) return;
    plusSyncAt = Date.now();
    plusSyncing = true;
    try {
      const next = settings.fakePlus ? (has ? status : status + PLUS_MARK) : status.replaceAll(PLUS_MARK, "") || null;
      const saved = await patchProfile(id, { custom_status: next });
      if (!saved) return;
      rememberProfile(id, { custom_status: next });
      syncedPlus = settings.fakePlus;
    } catch {
      /* the badge still shows on this computer */
    } finally {
      plusSyncing = false;
    }
  }

  function plusIds() {
    const ids = new Set();
    const store = getStore();
    const snap = store ? store.getState() : null;
    const profiles = snap?.profiles || {};
    for (const [id, profile] of Object.entries(profiles)) {
      if (profileMarked(profile) || (id === snap?.userId && settings.fakePlus)) ids.add(id);
    }
    return ids;
  }

  function plusNames(ids) {
    const names = new Set();
    const store = getStore();
    const profiles = store ? store.getState().profiles || {} : {};
    for (const [id, profile] of Object.entries(profiles)) {
      if (!profile || !ids.has(id)) continue;
      const display = cleanPlusName(profile.display_name || profile.username);
      const username = cleanPlusName(profile.username);
      if (display) names.add(display.toLowerCase());
      if (username) names.add(username.toLowerCase());
    }
    return names;
  }

  function userIdFromNode(node) {
    let fiber = fiberOf(node);
    const seen = new Set();
    for (let i = 0; fiber && i < 80 && !seen.has(fiber); i += 1) {
      seen.add(fiber);
      const props = fiber.memoizedProps;
      if (props && typeof props === "object") {
        if (typeof props.userId === "string") return props.userId;
        if (typeof props.author_id === "string") return props.author_id;
        if (typeof props.profile?.id === "string") return props.profile.id;
        if (typeof props.message?.author_id === "string") return props.message.author_id;
      }
      fiber = fiber.return;
    }
    return null;
  }

  async function refreshProfiles(ids) {
    if (!captured) return;
    const now = Date.now();
    const pending = [...ids].filter((id) => id && now - (refreshedAt.get(id) || 0) > 5000).slice(0, 30);
    if (!pending.length) return;
    pending.forEach((id) => refreshedAt.set(id, now));
    try {
      const filter = pending.map((id) => `"${id}"`).join(",");
      const res = await origFetch(
        `${captured.base}/rest/v1/profiles?id=in.(${filter})&select=id,display_name,custom_status,bio,username`,
        { headers: restHeaders() }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      for (const row of rows) rememberProfile(row.id, row);
    } catch {
      pending.forEach((id) => refreshedAt.delete(id));
    }
  }

  function makePlusBadge() {
    const badge = document.createElement("span");
    badge.className = "plus-badge";
    badge.dataset.venpperPlus = "1";
    badge.textContent = "PLUS";
    badge.title = "Yapper Plus";
    return badge;
  }

  function badgeAfter(el, show) {
    if (!el) return;
    const next = el.nextElementSibling;
    const ours = next?.dataset?.venpperPlus ? next : null;
    const real = next?.classList?.contains("plus-badge") && !next.dataset.venpperPlus;
    if (!show || real) {
      ours?.remove();
      return;
    }
    if (ours) return;
    el.after(makePlusBadge());
  }

  function cardMatches(card, names, ids) {
    const id = userIdFromNode(card);
    if (id && ids.has(id)) return true;
    const name = cleanPlusName(card.querySelector(".pc2-name")?.textContent).toLowerCase();
    const handle = card.querySelector(".pc-handle")?.textContent || "";
    const username = cleanPlusName((handle.match(/@([^\s·]+)/) || [])[1] || "").toLowerCase();
    return names.has(name) || (username && names.has(username));
  }

  function profilePlusTick(names, ids) {
    document.querySelectorAll(".profile-card, .pc2").forEach((card) => {
      if (!card.querySelector(".pc2-name")) return;
      const show = cardMatches(card, names, ids);
      const badges = card.querySelector(".pc2-badges");
      const ours = badges?.querySelector("[data-venpper-plus]");
      const real = badges?.querySelector(".plus-badge:not([data-venpper-plus])");
      if (!badges || !show || real) ours?.remove();
      else if (!ours) badges.appendChild(makePlusBadge());

      let roles = card.querySelector(".pc-roles");
      const roleOurs = card.querySelector(".pc-role[data-venpper-plus]");
      const hasPlusRole = [...(roles?.querySelectorAll(".pc-role") || [])].some(
        (el) => !el.dataset.venpperPlus && cleanPlusName(el.textContent).toLowerCase() === "plus"
      );
      if (!show || hasPlusRole) {
        roleOurs?.remove();
        card.querySelector(".profile-card-section[data-venpper-plus]")?.remove();
        return;
      }
      if (!roles) {
        const body = card.querySelector(".pc2-body");
        if (!body) return;
        const section = document.createElement("div");
        section.className = "profile-card-section";
        section.dataset.venpperPlus = "1";
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = "Roles";
        roles = document.createElement("div");
        roles.className = "pc-roles";
        section.append(label, roles);
        const status = body.querySelector(".pc2-status");
        if (status) status.after(section);
        else body.prepend(section);
      }
      if (roles.querySelector(".pc-role[data-venpper-plus]")) return;
      const pill = document.createElement("span");
      pill.className = "pc-role";
      pill.dataset.venpperPlus = "1";
      const dot = document.createElement("span");
      dot.className = "pc-role-dot";
      dot.style.background = "#b9bbbe";
      pill.append(dot, document.createTextNode("Plus"));
      roles.prepend(pill);
    });
  }

  function hiddenIds() {
    const ids = new Set();
    if (!settings.streamer) return ids;
    const snap = getStore()?.getState();
    if (!snap) return ids;
    if (snap.userId) ids.add(snap.userId);
    for (const [id, status] of Object.entries(snap.friends || {})) {
      if (status === "accepted") ids.add(id);
    }
    return ids;
  }

  function censorName(value) {
    const at = String(value).trim().startsWith("@");
    const clean = cleanPlusName(value).replace(/^@/, "");
    const body = clean.length <= 1 ? "…" : `${clean.slice(0, 2)}…`;
    return at ? `@${body}` : body;
  }

  const streamerOriginals = new WeakMap();

  function censorElement(el, hide) {
    const textNode = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const target = textNode || (el.childElementCount === 0 ? el : null);
    if (!target) return;
    if (!hide) {
      const original = streamerOriginals.get(el);
      if (original != null) {
        if (textNode) textNode.textContent = original;
        else el.textContent = original;
        streamerOriginals.delete(el);
      }
      return;
    }
    const current = textNode ? textNode.textContent : el.textContent;
    if (!streamerOriginals.has(el)) streamerOriginals.set(el, current);
    const next = censorName(streamerOriginals.get(el));
    if (textNode) textNode.textContent = next;
    else el.textContent = next;
  }

  function streamerTick() {
    const ids = hiddenIds();
    const profiles = getStore()?.getState().profiles || {};
    const names = new Set();
    for (const id of ids) {
      const profile = profiles[id];
      if (!profile) continue;
      const display = cleanPlusName(profile.display_name || profile.username).toLowerCase();
      const username = cleanPlusName(profile.username).toLowerCase();
      if (display) names.add(display);
      if (username) names.add(username);
    }
    const nodes = [
      ...document.querySelectorAll(".msg-author"),
      ...document.querySelectorAll(".pick-row-name > span:first-child"),
      ...document.querySelectorAll(".user-bar .uname"),
      ...document.querySelectorAll(".pc2-name"),
      ...document.querySelectorAll(".pc-handle span"),
      ...document.querySelectorAll(".voice-tile-name"),
    ];
    for (const el of nodes) {
      const id = userIdFromNode(el);
      const shown = cleanPlusName(el.textContent).replace(/^@/, "").toLowerCase();
      const mine = el.closest(".user-bar");
      censorElement(el, settings.streamer && (mine || (id && ids.has(id)) || names.has(shown)));
    }
  }

  function plusSectionTick(ids, names) {
    document.querySelectorAll(".members-panel").forEach((panel) => {
      if (!(panel.querySelector(".side-panel-head")?.textContent || "").includes("Members")) return;
      const plusLabel = [...panel.querySelectorAll(".section-label")].find((el) =>
        /^plus$/i.test((el.dataset.venpperTitle || el.textContent.split(" - ")[0]).trim())
      );
      if (!plusLabel) return;
      const plusGroup = plusLabel.parentElement;
      for (const row of [...panel.querySelectorAll(".pick-row")]) {
        const id = userIdFromNode(row);
        const name = cleanPlusName(row.querySelector(".pick-row-name span")?.textContent).toLowerCase();
        const show = (id && ids.has(id)) || names.has(name);
        if (!show || plusGroup.contains(row)) continue;
        plusGroup.appendChild(row);
      }
      for (const label of panel.querySelectorAll(".section-label")) {
        const title = (label.dataset.venpperTitle || label.textContent.split(" - ")[0]).trim();
        label.dataset.venpperTitle = title;
        const count = label.parentElement.querySelectorAll(":scope > .pick-row").length;
        label.textContent = `${title} - ${count}`;
        label.parentElement.style.display = count === 0 ? "none" : "";
      }
    });
  }

  function hideMarkOnlyStatus() {
    document.querySelectorAll(".pc2-custom, .pick-row-sub, .user-bar .status").forEach((el) => {
      const visible = cleanPlusName(el.textContent);
      const raw = el.textContent || "";
      el.classList.toggle("venpper-mark-only", raw.includes(PLUS_MARK) && !visible);
    });
  }

  function fakePlusTick() {
    const ids = plusIds();
    const names = plusNames(ids);
    const refresh = new Set();
    document.querySelectorAll(".msg").forEach((msg) => {
      const id = userIdFromNode(msg);
      if (id) refresh.add(id);
      const author = msg.querySelector(".msg-author");
      if (!author) return;
      const name = cleanPlusName(author.textContent).toLowerCase();
      badgeAfter(author, (id && ids.has(id)) || names.has(name));
    });
    const nodes = [
      ...document.querySelectorAll(".pick-row-name > span:first-child"),
      ...document.querySelectorAll(".user-bar .uname"),
    ];
    for (const el of nodes) {
      const id = userIdFromNode(el);
      if (id) refresh.add(id);
      const name = cleanPlusName(el.textContent).toLowerCase();
      badgeAfter(el, (id && ids.has(id)) || names.has(name));
    }
    document.querySelectorAll(".profile-card, .pc2").forEach((card) => {
      const id = userIdFromNode(card);
      if (id) refresh.add(id);
    });
    profilePlusTick(names, ids);
    plusSectionTick(ids, names);
    hideMarkOnlyStatus();
    streamerTick();
    refreshProfiles(refresh);
  }

  function clearFakePlus() {
    document.querySelectorAll("[data-venpper-plus]").forEach((node) => node.remove());
  }

  function placeLauncher() {
    const bar = document.querySelector(".user-bar");
    if (bar && launcher.parentElement !== bar) bar.appendChild(launcher);
    const docked = launcher.parentElement === bar;
    launcher.classList.toggle("docked", docked);
    panel.classList.toggle("docked", docked);
  }

  function applyMods() {
    placeLauncher();
    if (settings.readAll) placeReadAll();
    else stopReadAll();
    if (settings.deleted) deletedTick();
    else stopDeleted();
    if (settings.privacy) privacyTick();
    else {
      unblurred = false;
      clearBlur();
    }
    fakePlusTick();
    syncFakePlus();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      placeLauncher();
      if (settings.readAll) placeReadAll();
      if (settings.deleted) deletedTick();
      if (settings.privacy) privacyTick();
      fakePlusTick();
      syncFakePlus();
    });
  }

  function start() {
    syncPanel();
    applyMods();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
