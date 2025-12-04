const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  versions: process.versions,
});
