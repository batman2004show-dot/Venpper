const fs = require("fs");
const path = require("path");
const { writeIcons } = require("./make-icon");

const root = __dirname;

function align(size) {
  return size + ((4 - (size % 4)) % 4);
}

function pickleString(value) {
  const bytes = Buffer.from(value, "utf8");
  const padded = align(bytes.length);
  const payload = 4 + padded;
  const out = Buffer.alloc(4 + payload);
  out.writeUInt32LE(payload, 0);
  out.writeUInt32LE(bytes.length, 4);
  bytes.copy(out, 8);
  return out;
}

function pickleUint32(value) {
  const out = Buffer.alloc(8);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(value, 4);
  return out;
}

function pack() {
  writeIcons(path.join(root, "build"));
  const iconPath = path.join(root, "icon.png");
  const entries = [
    ["package.json", fs.readFileSync(path.join(root, "package.json"))],
    ["brand.js", fs.readFileSync(path.join(root, "brand.js"))],
    ["main.js", fs.readFileSync(path.join(root, "main.js"))],
    ["preload.js", fs.readFileSync(path.join(root, "preload.js"))],
    ["icon.png", fs.readFileSync(iconPath)],
    ["src/inject.js", fs.readFileSync(path.join(root, "src", "inject.js"))],
  ];

  let cursor = 0;
  const header = { files: {} };
  const chunks = [];
  for (const [rel, data] of entries) {
    const parts = rel.split("/");
    let node = header;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node.files[parts[i]] = node.files[parts[i]] || { files: {} };
      node = node.files[parts[i]];
    }
    node.files[parts[parts.length - 1]] = { size: data.length, offset: String(cursor) };
    chunks.push(data);
    cursor += data.length;
  }

  const headerPickle = pickleString(JSON.stringify(header));
  const sizePickle = pickleUint32(headerPickle.length);
  const outDir = path.join(root, "build");
  fs.mkdirSync(outDir, { recursive: true });
  const asarPath = path.join(outDir, "app.asar");
  fs.writeFileSync(asarPath, Buffer.concat([sizePickle, headerPickle, ...chunks]));
  console.log(asarPath, fs.statSync(asarPath).size);
}

pack();
