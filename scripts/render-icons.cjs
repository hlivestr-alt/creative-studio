const { app, BrowserWindow } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

const rootDirectory = resolve(__dirname, '..');
const assetsDirectory = join(rootDirectory, 'assets');
const sourcePath = join(assetsDirectory, 'app-icon.svg');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const renderSize = 512;

function createHtml(svgSource, size) {
  const svgData = Buffer.from(svgSource, 'utf8').toString('base64');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { width: ${size}px; height: ${size}px; margin: 0; overflow: hidden; background: #0A0A0A; }
  img { display: block; width: ${size}px; height: ${size}px; }
</style></head><body><img src="data:image/svg+xml;base64,${svgData}" alt=""></body></html>`;
}

function createRenderWindow() {
  return new BrowserWindow({
    width: renderSize,
    height: renderSize,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#0A0A0A',
    paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
}

async function captureIcon(window, size) {
  const captured = await window.webContents.capturePage();
  const normalized = captured.getSize().width === renderSize && captured.getSize().height === renderSize
    ? captured
    : captured.resize({ width: renderSize, height: renderSize, quality: 'best' });
  return (size === renderSize ? normalized : normalized.resize({ width: size, height: size, quality: 'best' })).toPNG();
}

function createIco(entries) {
  const header = Buffer.alloc(6 + (entries.length * 16));
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = header.length;
  entries.forEach(({ size, png }, index) => {
    const position = 6 + (index * 16);
    header.writeUInt8(size >= 256 ? 0 : size, position);
    header.writeUInt8(size >= 256 ? 0 : size, position + 1);
    header.writeUInt8(0, position + 2);
    header.writeUInt8(0, position + 3);
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(png.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...entries.map(({ png }) => png)]);
}

async function main() {
  await mkdir(assetsDirectory, { recursive: true });
  const svgSource = await readFile(sourcePath, 'utf8');
  const entries = [];
  const renderWindow = createRenderWindow();

  try {
    await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createHtml(svgSource, renderSize))}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
    await renderWindow.webContents.executeJavaScript('document.body.offsetWidth');
    for (const size of sizes) {
      const png = await captureIcon(renderWindow, size);
      await writeFile(join(assetsDirectory, `app-icon-${size}.png`), png);
      entries.push({ size, png });
    }

    await writeFile(join(assetsDirectory, 'app-icon.ico'), createIco(entries.filter(({ size }) => size !== 512)));
    console.log(`Generated ${entries.length} PNG sizes and ${join(assetsDirectory, 'app-icon.ico')}`);
  } finally {
    renderWindow.destroy();
  }
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  console.error(error?.stack ?? error);
  app.exit(1);
});
