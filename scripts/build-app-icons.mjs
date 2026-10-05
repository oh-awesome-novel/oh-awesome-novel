import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Asset preparation only. CI and installers consume the committed outputs;
// they do not need image generators, extra npm packages, or macOS icon tools.
if (process.platform !== 'darwin') {
  throw new Error('Regenerate icons on macOS with sips and iconutil. Other platforms use the committed icon files.');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'apps/desktop/assets/icon-source.png');
const output = join(root, 'apps/desktop/assets/icons');
const renderer = join(root, 'apps/desktop-ui/public');
const rendererAssets = join(root, 'apps/desktop-ui/src/assets');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const sourceSize = pngSize(readFileSync(source));
if (sourceSize.width !== sourceSize.height || sourceSize.width < 1024) {
  throw new Error('The icon source must be a square PNG of at least 1024 pixels.');
}
const temporary = mkdtempSync(join(tmpdir(), 'oan-app-icons-'));

try {
  mkdirSync(output, { recursive: true });
  mkdirSync(renderer, { recursive: true });
  mkdirSync(rendererAssets, { recursive: true });
  for (const size of sizes) {
    execFileSync('/usr/bin/sips', ['--resampleHeightWidth', String(size), String(size), source,
      '--out', join(temporary, `${size}.png`)], { stdio: 'pipe' });
  }

  copyFileSync(join(temporary, '1024.png'), join(output, 'icon.png'));
  copyFileSync(join(temporary, '512.png'), join(output, 'icon-512.png'));
  copyFileSync(join(temporary, '256.png'), join(rendererAssets, 'oan-app-icon.png'));
  copyFileSync(join(temporary, '32.png'), join(renderer, 'favicon-32.png'));

  // ICONDIR + ICONDIRENTRY table with real PNG payloads. PNG-compressed frames
  // are supported by all Windows versions supported by this Electron release.
  // A PNG renamed to .ico is not a valid Windows icon.
  const icoSizes = sizes.filter((size) => size <= 256);
  const images = icoSizes.map((size) => readFileSync(join(temporary, `${size}.png`)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [index, image] of images.entries()) {
    const size = icoSizes[index];
    const entry = 6 + 16 * index;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  }
  writeFileSync(join(output, 'icon.ico'), Buffer.concat([header, ...images]));

  const iconset = join(temporary, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    copyFileSync(join(temporary, `${size}.png`), join(iconset, `icon_${size}x${size}.png`));
    copyFileSync(join(temporary, `${size * 2}.png`), join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', join(output, 'icon.icns'), iconset], { stdio: 'pipe' });
  console.log('Generated desktop PNG/ICO/ICNS, launcher image, and favicon from icon-source.png.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function pngSize(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Expected a valid PNG source.');
  }
  if (buffer[25] !== 6) throw new Error('The source must preserve RGBA transparency.');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
