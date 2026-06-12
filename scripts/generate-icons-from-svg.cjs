const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, readFileSync, unlinkSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { dirname, extname, join, resolve } = require('path');
const { pathToFileURL } = require('url');

const [, , sourceArg, ...targetArgs] = process.argv;

if (!sourceArg || targetArgs.length === 0) {
  console.error('Usage: electron scripts/generate-icons-from-svg.cjs <source.svg> <target.ico> [target.ico ...]');
  process.exit(1);
}

function icoFromPngBuffers(entries) {
  const headerSize = 6;
  const directorySize = 16 * entries.length;
  let imageOffset = headerSize + directorySize;
  const directory = Buffer.alloc(directorySize);

  entries.forEach((entry, index) => {
    const offset = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset + 1);
    directory.writeUInt8(0, offset + 2);
    directory.writeUInt8(0, offset + 3);
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(entry.buffer.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += entry.buffer.length;
  });

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.buffer)]);
}

function htmlForSvg(svg) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: grid;
        place-items: center;
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`;
}

function addIconContrastPlate(svg) {
  const contrastPlate = '<rect width="100%" height="100%" rx="20%" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2%" />';
  return svg.replace(/(<svg\b[^>]*>)/i, `$1\n${contrastPlate}`);
}

async function renderPng(svg, size) {
  const tempHtmlPath = join(tmpdir(), `bug-pocket-icon-${process.pid}.html`);
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true
    }
  });

  const html = htmlForSvg(svg);
  writeFileSync(tempHtmlPath, html);
  try {
    await win.loadURL(pathToFileURL(tempHtmlPath).toString());
    await new Promise((resolve) => setTimeout(resolve, 60));
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.destroy();
    try {
      unlinkSync(tempHtmlPath);
    } catch {
      // Best-effort temp cleanup.
    }
  }
}

app.whenReady().then(async () => {
  const sourcePath = resolve(sourceArg);
  const svg = addIconContrastPlate(readFileSync(sourcePath, 'utf8'));

  const sourcePng = await renderPng(svg, 1024);
  const sourceImage = nativeImage.createFromBuffer(sourcePng);
  if (sourceImage.isEmpty()) throw new Error('Rendered SVG image was empty.');

  const sizes = [16, 32, 64, 256];
  const entries = sizes.map((size) => ({
    size,
    buffer: sourceImage.resize({ width: size, height: size }).toPNG()
  }));
  const ico = icoFromPngBuffers(entries);

  targetArgs.forEach((targetArg) => {
    const targetPath = resolve(targetArg);
    mkdirSync(dirname(targetPath), { recursive: true });
    if (extname(targetPath).toLowerCase() === '.png') {
      writeFileSync(targetPath, sourceImage.resize({ width: 256, height: 256 }).toPNG());
    } else {
      writeFileSync(targetPath, ico);
    }
  });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  app.quit();
});
