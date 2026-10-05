/**
 * Minimal PNG decoder used by the UI smoke test.
 *
 * The visual audit needs to assert on what was actually rendered — average
 * lightness, colour temperature, whether the background is flat or layered —
 * so it decodes a Chrome screenshot instead of trusting the stylesheet.
 *
 * Scope: 8-bit non-interlaced RGB/RGBA, which is what Chrome produces. Enough
 * for tests, not a general purpose decoder.
 */
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(input) {
  // Puppeteer hands back a Uint8Array; Node's helpers want a Buffer.
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const line = raw.subarray(offset, offset + stride);
    offset += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels] : 0;
      const b = previous ? previous[x] : 0;
      const c = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];

      switch (filter) {
        case 0:
          break;
        case 1:
          value = (value + a) & 0xff;
          break;
        case 2:
          value = (value + b) & 0xff;
          break;
        case 3:
          value = (value + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (value + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`unsupported scanline filter ${filter}`);
      }
      current[x] = value;
    }
  }

  return { width, height, channels, data: pixels };
}

/** Relative luminance of one pixel, WCAG 2.x definition. */
export function pixelLuminance(image, x, y) {
  const i = (y * image.width + x) * image.channels;
  const { data } = image;
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(data[i]) + 0.7152 * f(data[i + 1]) + 0.0722 * f(data[i + 2]);
}

/** Raw RGB of one pixel, 0-255. */
export function pixelRgb(image, x, y) {
  const i = (y * image.width + x) * image.channels;
  return { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] };
}

/** Average colour of a rectangular region. */
export function averageRegion(image, left, top, width, height) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const x1 = Math.min(image.width, left + width);
  const y1 = Math.min(image.height, top + height);
  for (let y = Math.max(0, top); y < y1; y++) {
    for (let x = Math.max(0, left); x < x1; x++) {
      const p = pixelRgb(image, x, y);
      r += p.r;
      g += p.g;
      b += p.b;
      n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n, samples: n } : null;
}
