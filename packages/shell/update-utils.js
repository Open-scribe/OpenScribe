function compareVersions(current, latest) {
  const currentParts = String(current).split('.').map(Number);
  const latestParts = String(latest).split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i += 1) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }

  return 0;
}

function getDownloadUrlFor(assets, platform, arch) {
  if (platform === 'darwin') {
    const armAsset = assets.find((asset) => asset.name.includes('arm64') && asset.name.includes('dmg'));
    const intelAsset = assets.find((asset) => asset.name.includes('x64') && asset.name.includes('dmg'));

    if (arch === 'arm64' && armAsset) return armAsset.browser_download_url;
    if (intelAsset) return intelAsset.browser_download_url;
    if (armAsset) return armAsset.browser_download_url;
  }

  if (platform === 'win32') {
    const setupExe = assets.find((asset) => asset.name.includes('Setup') && asset.name.endsWith('.exe'));
    const winZip = assets.find((asset) => asset.name.includes('win') && asset.name.endsWith('.zip'));
    if (setupExe) return setupExe.browser_download_url;
    if (winZip) return winZip.browser_download_url;
  }

  if (platform === 'linux') {
    const archToken = arch === 'arm64' ? 'arm64' : 'x64';
    const appImage = assets.find((asset) => asset.name.includes('AppImage') && asset.name.includes(archToken));
    const deb = assets.find((asset) => asset.name.endsWith('.deb') && asset.name.includes(archToken));
    if (appImage) return appImage.browser_download_url;
    if (deb) return deb.browser_download_url;
  }

  return assets.length > 0 ? assets[0].browser_download_url : null;
}

function getDownloadUrl(assets) {
  return getDownloadUrlFor(assets, process.platform, process.arch);
}

module.exports = {
  compareVersions,
  getDownloadUrl,
  getDownloadUrlFor,
};
