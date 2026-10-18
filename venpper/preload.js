const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yapperDesktop", {
  version: "1.0.0",
  platform: process.platform,
  setBadge: (count) => ipcRenderer.send("yapper:badge", Number(count) || 0),
  notify: (note) =>
    ipcRenderer.send("yapper:notify", {
      title: note?.title,
      body: note?.body,
      url: note?.url,
    }),
});
