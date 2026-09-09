// Genera els icons PWA a partir del logo de POLSER (Node pur, zlib).
//
// - Baixa el logo de https://media.polser.cat/logos/polser_favicon.png
// - El redimensiona (bilinear) i el composa sobre fons navy (#042149)
//   amb safe-zone per a icons maskable.
// - Genera: icon-512.png, icon-192.png, icon-180.png, icon-64.png
//
// Ús: node scripts/generate-icons.cjs  (des de portal/)

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const LOGO_URL = 'https://media.polser.cat/logos/polser_favicon.png';
const NAVY = [4, 33, 73, 255];

// ---------- PNG encode ----------
function crc32(buf) {
  if (!crc32.table) {
    crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- PNG decode (8-bit RGBA) ----------
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`Només PNG 8-bit RGBA (${bitDepth}/${colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = 4;
  const stride = width * channels;
  const px = Buffer.alloc(width * height * channels);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      let v = row[x];
      const left = x >= channels ? px[y * stride + x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) v = (v + left) & 0xff;
      else if (filter === 2) v = (v + up) & 0xff;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        v = (v + pr) & 0xff;
      }
      px[y * stride + x] = v;
    }
    prev.set(row);
  }
  return { width, height, data: px };
}

// ---------- Redimensionament (bilinear) ----------
function sample(data, w, h, x, y) {
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx, yy, i) => data[(yy * w + xx) * 4 + i];
  return [
    (1 - fx) * (1 - fy) * at(x0, y0, 0) + fx * (1 - fy) * at(x1, y0, 0) + (1 - fx) * fy * at(x0, y1, 0) + fx * fy * at(x1, y1, 0),
    (1 - fx) * (1 - fy) * at(x0, y0, 1) + fx * (1 - fy) * at(x1, y0, 1) + (1 - fx) * fy * at(x0, y1, 1) + fx * fy * at(x1, y1, 1),
    (1 - fx) * (1 - fy) * at(x0, y0, 2) + fx * (1 - fy) * at(x1, y0, 2) + (1 - fx) * fy * at(x0, y1, 2) + fx * fy * at(x1, y1, 2),
    (1 - fx) * (1 - fy) * at(x0, y0, 3) + fx * (1 - fy) * at(x1, y0, 3) + (1 - fx) * fy * at(x0, y1, 3) + fx * fy * at(x1, y1, 3),
  ];
}

// ---------- Render: navy rounded + logo centrat (safe-zone ~72%) ----------
function render(size, logo) {
  const out = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;
  const target = size * 0.74;
  const sx = (size - target) / 2;
  const sy = (size - target) / 2;
  const lw = logo.width;
  const lh = logo.height;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      if (!inside) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
        continue;
      }
      out[i] = NAVY[0];
      out[i + 1] = NAVY[1];
      out[i + 2] = NAVY[2];
      out[i + 3] = NAVY[3];

      const lx = ((x - sx) / target) * lw;
      const ly = ((y - sy) / target) * lh;
      if (lx >= 0 && ly >= 0 && lx < lw && ly < lh) {
        const [r, g, b, a] = sample(logo.data, lw, lh, lx, ly);
        const al = a / 255;
        if (al > 0.02) {
          out[i] = Math.round(r * al + NAVY[0] * (1 - al));
          out[i + 1] = Math.round(g * al + NAVY[1] * (1 - al));
          out[i + 2] = Math.round(b * al + NAVY[2] * (1 - al));
          out[i + 3] = 255;
        }
      }
    }
  }
  return encodePng(size, size, out);
}

// ---------- Main ----------
async function main() {
  const dir = path.join(__dirname, '..', 'public', 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const cacheDir = path.join(__dirname, '..', 'node_modules', '.cache-icons');
  fs.mkdirSync(cacheDir, { recursive: true });
  const srcPath = path.join(cacheDir, 'polser_logo.png');
  let srcBuf;
  try {
    if (!fs.existsSync(srcPath)) {
      const res = await fetch(LOGO_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      srcBuf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(srcPath, srcBuf);
      console.log('logo descarregat:', LOGO_URL);
    } else {
      srcBuf = fs.readFileSync(srcPath);
      console.log('logo en caché (.source.png)');
    }
    const logo = decodePng(srcBuf);
    console.log('logo:', logo.width, 'x', logo.height);
    for (const size of [512, 192, 180, 64]) {
      fs.writeFileSync(path.join(dir, `icon-${size}.png`), render(size, logo));
    }
    console.log('icons generats a', dir);
  } catch (err) {
    console.error('ERROR generant icons:', err.message);
    process.exit(1);
  }
}

main();