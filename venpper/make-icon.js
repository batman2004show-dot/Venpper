const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = zlib.crc32(body);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const thickness = size * 0.075;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const i = row + 1 + x * 4;
      const insetX = Math.min(x, size - 1 - x);
      const insetY = Math.min(y, size - 1 - y);
      let inside = true;
      if (insetX < radius && insetY < radius) {
        const cx = radius - insetX;
        const cy = radius - insetY;
        inside = cx * cx + cy * cy <= radius * radius;
      }
      if (!inside) continue;
      raw[i] = 28;
      raw[i + 1] = 29;
      raw[i + 2] = 38;
      raw[i + 3] = 255;
      const left = distToSegment(x, y, size * 0.28, size * 0.24, size * 0.5, size * 0.76);
      const right = distToSegment(x, y, size * 0.72, size * 0.24, size * 0.5, size * 0.76);
      if (Math.min(left, right) <= thickness) {
        raw[i] = 244;
        raw[i + 1] = 245;
        raw[i + 2] = 250;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const count = images.length;
  const header = 6 + 16 * count;
  let offset = header;
  const entries = [];
  const blobs = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(image.png);
    offset += image.png.length;
  }
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  return Buffer.concat([dir, ...entries, ...blobs]);
}

function writeIcons(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const images = [16, 32, 48, 256].map((size) => ({ size, png: png(size) }));
  const pngPath = path.join(dir, "icon.png");
  const icoPath = path.join(dir, "icon.ico");
  fs.writeFileSync(pngPath, images[3].png);
  fs.writeFileSync(icoPath, ico(images));
  fs.copyFileSync(pngPath, path.join(__dirname, "icon.png"));
  return { pngPath, icoPath };
}

if (require.main === module) {
  const out = writeIcons(path.join(__dirname, "build"));
  console.log(out.pngPath, out.icoPath);
}

module.exports = { writeIcons };
