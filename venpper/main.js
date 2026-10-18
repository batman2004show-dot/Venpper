const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
  session,
  desktopCapturer,
  ipcMain,
  Notification,
} = require("electron");
const fs = require("fs");
const path = require("path");
const brand = require("./brand");

const SITE = "https://www.yapper.website";
const ALLOWED = new Set([
  "www.yapper.website",
  "yapper.website",
  "rt.yapper.website",
  "lk.yapper.website",
]);

if (process.platform === "win32") app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let quitting = false;
let injection = "";

function log(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "venpper.log"),
      `${new Date().toISOString()} ${line}\n`
    );
  } catch {
    /* logging must not take the app down */
  }
}

function injectionSource() {
  if (!injection) injection = fs.readFileSync(path.join(__dirname, "src", "inject.js"), "utf8");
  return injection;
}

function show() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openDeepLink(url) {
  if (!win || win.isDestroyed() || typeof url !== "string" || !url.startsWith("yapper://")) return;
  const rest = url.slice("yapper://".length).replace(/^\/+/, "");
  win.loadURL(`${SITE}/${rest}`);
  show();
}

function allowedUrl(url) {
  try {
    return ALLOWED.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function showLoadError(description) {
  if (!win || win.isDestroyed()) return;
  const message = String(description || "Yapper didn't open.").replace(/[<>&]/g, "");
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1c1d26;color:#f4f5fa;font:16px Segoe UI,sans-serif">
    <div style="max-width:420px;text-align:center">
      <h1 style="font-size:22px;margin:0 0 8px">Venpper couldn't open Yapper</h1>
      <p style="color:#b5bac1">${message}</p>
      <p><a href="${SITE}" style="color:#f4f5fa">Try again</a></p>
    </div>
  </body></html>`;
  win.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  show();
}

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: brand.name,
    icon: icon.isEmpty() ? undefined : icon,
    backgroundColor: "#1c1d26",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  const source = injectionSource();
  win.webContents.on("dom-ready", () => {
    const url = win.webContents.getURL();
    if (!url.startsWith("http")) return;
    win.webContents.executeJavaScript(source).catch((error) => log(`inject ${error}`));
  });

  win.on("ready-to-show", () => {
    if (win.webContents.getURL().startsWith("http")) show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedUrl(url)) {
      win.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || allowedUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || url.startsWith("data:")) return;
    log(`fail ${code} ${description} ${url}`);
    showLoadError(description);
  });

  win.webContents.on("did-finish-load", () => {
    log(`loaded ${win.webContents.getURL()}`);
    if (win.webContents.getURL().startsWith("http")) show();
  });

  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    win = null;
  });

  win.loadURL(SITE).catch((error) => {
    log(`load ${error}`);
    showLoadError(error && error.message);
  });
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip(brand.name);
  const menu = [
    { label: `Open ${brand.name}`, click: show },
    { type: "separator" },
    {
      label: `Quit ${brand.name}`,
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ];
  if (brand.website) {
    menu.splice(1, 0, {
      label: "Website",
      click: () => shell.openExternal(brand.website),
    });
  }
  tray.setContextMenu(Menu.buildFromTemplate(menu));
  tray.on("click", show);
  tray.on("double-click", show);
}

app.setName(brand.name);
app.on("second-instance", (_event, argv) => {
  show();
  openDeepLink(argv.find((arg) => arg.startsWith("yapper://")));
});

app.whenReady().then(() => {
  app.userAgentFallback = `${app.userAgentFallback} YapperDesktop/${app.getVersion()} Venpper/${brand.version}`;
  if (process.platform === "win32") app.setAppUserModelId("website.yapper.venpper");

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    let host = "";
    try {
      host = new URL(details.requestingUrl || "").hostname;
    } catch {
      /* ignore */
    }
    callback(
      ALLOWED.has(host) &&
        ["media", "notifications", "display-capture", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(
          permission
        )
    );
  });
  ses.setPermissionCheckHandler((_wc, _permission, origin) => {
    try {
      return ALLOWED.has(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const screen = sources.find((source) => source.id.startsWith("screen")) ?? sources[0];
      if (!screen) return callback({});
      callback({ video: screen, audio: "loopback" });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });

  ipcMain.on("yapper:badge", (_event, count) => {
    if (win && !win.isDestroyed() && count > 0 && !win.isFocused()) win.flashFrame(true);
  });
  ipcMain.on("yapper:notify", (_event, note) => {
    if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused())) return;
    const notification = new Notification({
      title: String(note?.title ?? "Yapper").slice(0, 80),
      body: String(note?.body ?? "").slice(0, 180),
      icon: path.join(__dirname, "icon.png"),
      silent: true,
    });
    notification.on("click", () => {
      show();
      if (note?.url && win && !win.isDestroyed()) win.loadURL(`${SITE}${note.url}`);
    });
    notification.show();
  });

  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  openDeepLink(process.argv.find((arg) => arg.startsWith("yapper://")));
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  /* stay in the tray until Quit */
});
app.on("activate", () => {
  if (win) show();
  else createWindow();
});
