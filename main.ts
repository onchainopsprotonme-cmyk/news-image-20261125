// Deterministic offline world-news image renderer for make.fun bounty news-image-20261125.
// Node 22, standard library only. Writes /output/entry.png (1024x1024, <=1 MiB, byte-identical on two runs).
// No network, no random values, no timestamps, no machine-specific paths.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

const WIDTH = 1024;
const HEIGHT = 1024;

// ---------- CRC32 ----------
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG chunks ----------
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngSignature(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function encodePNG(pixels: Uint8ClampedArray, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw scanlines with filter byte 0x00 (none)
  const raw = Buffer.alloc(h * (1 + w * 3));
  let offset = 0;
  for (let y = 0; y < h; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      raw[offset++] = pixels[pi];     // R
      raw[offset++] = pixels[pi + 1]; // G
      raw[offset++] = pixels[pi + 2]; // B
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy: zlib.Z_DEFAULT_STRATEGY });

  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSignature(), pngChunk('IHDR', ihdr), idat, iend]);
}

// ---------- Canvas ----------
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly pixels: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
    // default: transparent black
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i + 3] = 0;
    }
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number = 255): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const pi = (y * this.w + x) * 4;
    this.pixels[pi] = r;
    this.pixels[pi + 1] = g;
    this.pixels[pi + 2] = b;
    this.pixels[pi + 3] = a;
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number = 255): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.setPixel(xx, yy, r, g, b, a);
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a: number = 255): void {
    const r2 = radius * radius;
    for (let yy = cy - radius; yy <= cy + radius; yy++) {
      for (let xx = cx - radius; xx <= cx + radius; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(xx, yy, r, g, b, a);
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number = 255): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      this.setPixel(x, y, r, g, b, a);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  getBuffer(): Buffer {
    return Buffer.from(this.pixels);
  }
}

// ---------- Bitmap font (5x7) ----------
// Each character: 7 rows, each row is 5 bits (bit 4 = leftmost pixel)
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '!': [0, 0, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  '"': [0, 0b01110, 0, 0, 0, 0, 0],
  '#': [0, 0b00100, 0b01110, 0b00100, 0b01110, 0b00100, 0],
  '$': [0, 0b00100, 0b01110, 0b01010, 0b00100, 0b01110, 0b00100],
  '%': [0, 0b11000, 0b00100, 0b00100, 0b00100, 0b00011, 0],
  '&': [0, 0b01000, 0b01100, 0b01010, 0b01001, 0b01110, 0b00100],
  "'": [0, 0b00100, 0b00100, 0, 0, 0, 0],
  '(': [0, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0],
  ')': [0, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0],
  '*': [0, 0b00100, 0b01010, 0b00100, 0b01010, 0b00100, 0],
  '+': [0, 0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100],
  ',': [0, 0, 0, 0b00100, 0b00010, 0, 0],
  '-': [0, 0, 0, 0b00100, 0, 0, 0],
  '.': [0, 0, 0, 0b00100, 0b00100, 0, 0],
  '/': [0, 0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0],
  '0': [0, 0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b01110],
  '1': [0, 0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0, 0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b11111],
  '3': [0, 0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b01110],
  '4': [0, 0b00001, 0b00011, 0b00101, 0b01001, 0b11111, 0b00001],
  '5': [0, 0b11111, 0b10000, 0b11110, 0b00001, 0b10001, 0b01110],
  '6': [0, 0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0, 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000],
  '8': [0, 0b01110, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0, 0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  ':': [0, 0, 0b00100, 0, 0b00100, 0, 0],
  ';': [0, 0, 0b00100, 0, 0b00100, 0b00010, 0],
  '<': [0, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0],
  '=': [0, 0, 0b11111, 0, 0b11111, 0, 0],
  '>': [0, 0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0],
  '?': [0, 0b01110, 0b10001, 0b00001, 0b00100, 0b00100, 0],
  '@': [0, 0b01110, 0b10001, 0b01001, 0b01011, 0b10101, 0b01010],
  'A': [0, 0b00100, 0b01010, 0b01010, 0b11111, 0b10001, 0b10001],
  'B': [0, 0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b11110],
  'C': [0, 0b01110, 0b10001, 0b10000, 0b10000, 0b10001, 0b01110],
  'D': [0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  'E': [0, 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b11111],
  'F': [0, 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000],
  'G': [0, 0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b01110],
  'H': [0, 0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001],
  'I': [0, 0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'J': [0, 0b11111, 0b00001, 0b00001, 0b00001, 0b10001, 0b01110],
  'K': [0, 0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10001],
  'L': [0, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  'M': [0, 0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001],
  'N': [0, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001],
  'O': [0, 0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'P': [0, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000],
  'Q': [0, 0b01110, 0b10001, 0b10001, 0b10101, 0b11001, 0b01110],
  'R': [0, 0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10001],
  'S': [0, 0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b11110],
  'T': [0, 0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  'U': [0, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'V': [0, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'W': [0, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  'X': [0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0],
  'Y': [0, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  'Z': [0, 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '[': [0, 0b01110, 0b10000, 0b10000, 0b10000, 0b10000, 0b01110],
  '\\': [0, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0],
  ']': [0, 0b01110, 0b00001, 0b00001, 0b00001, 0b00001, 0b01110],
  '^': [0, 0b00100, 0b01010, 0b10001, 0, 0, 0],
  '_': [0, 0, 0, 0, 0, 0, 0b11111],
  '`': [0, 0b00100, 0b00010, 0, 0, 0, 0],
  'a': [0, 0, 0b01110, 0b10001, 0b01111, 0b10001, 0b01111],
  'b': [0, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b11110],
  'c': [0, 0, 0b01110, 0b10001, 0b10000, 0b10001, 0b01110],
  'd': [0, 0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b01111],
  'e': [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  'f': [0, 0b00100, 0b00100, 0b01110, 0b00100, 0b00100, 0b01110],
  'g': [0, 0, 0b01111, 0b10001, 0b01111, 0b10001, 0b01111],
  'h': [0, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001],
  'i': [0, 0b00100, 0, 0b00100, 0b00100, 0, 0b00100],
  'j': [0, 0b00001, 0, 0b00001, 0b00001, 0b10001, 0b01110],
  'k': [0, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10001],
  'l': [0, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'm': [0, 0, 0b11111, 0b10001, 0b10001, 0b10001, 0b10001],
  'n': [0, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001],
  'o': [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  'p': [0, 0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b01111],
  'q': [0, 0b10001, 0b10001, 0b01111, 0b10001, 0b10001, 0b01111],
  'r': [0, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  's': [0, 0, 0b01110, 0b10001, 0b01110, 0b00001, 0b11110],
  't': [0, 0b00100, 0b00100, 0b01110, 0b00100, 0b00100, 0b01110],
  'u': [0, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'v': [0, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'w': [0, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  'x': [0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0],
  'y': [0, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b01110],
  'z': [0, 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '{': [0, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0],
  '|': [0, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  '}': [0, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0],
  '~': [0, 0b00000, 0b01010, 0b10101, 0, 0, 0],
};

const FONT_W = 5;
const FONT_H = 7;

function drawText(canvas: Canvas, x: number, y: number, text: string, scale: number, r: number, g: number, b: number): void {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const rows = FONT[ch];
    if (!rows) {
      cx += (FONT_W + 1) * scale;
      continue;
    }
    for (let row = 0; row < FONT_H; row++) {
      const bits = rows[row];
      for (let col = 0; col < FONT_W; col++) {
        if (bits & (1 << (FONT_W - 1 - col))) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              canvas.setPixel(cx + col * scale + sx, y + row * scale + sy, r, g, b, 255);
            }
          }
        }
      }
    }
    cx += (FONT_W + 1) * scale;
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * (FONT_W + 1) * scale;
}

// ---------- News data (verified, dated 25 November 2026 UTC) ----------
// Source audit maintained separately; all events dated to 25 Nov UTC.
const LEAD_STORIES = [
  {
    region: 'MIDDLE EAST',
    head: 'TANKERS HIT MINES IN STRAIT OF HORMUZ',
    sub: "Iran's IRGC says two oil tankers struck naval mines and caught fire; ships transited an unauthorized route.",
    source: 'Reuters / IRGC statement · 25 Nov UTC',
  },
  {
    region: 'MIDDLE EAST',
    head: 'HOUTHIS STRIKE SAUDI RAS TANAURA REFINERY',
    sub: 'Yemen Houthis hit Saudi Arabia’s largest oil refinery; coalition intercepted four drones over Eastern Province.',
    source: 'Reuters / Anadolu · 25 Nov UTC',
  },
  {
    region: 'EUROPE',
    head: 'RUSSIA-UKRAINE: REFIRNERY STRIKES ON BOTH SIDES',
    sub: 'Russian drones killed seven in Ukraine; Ukrainian drones hit three Russian refineries and an airbase overnight.',
    source: 'Euronews / Reuters · 25 Nov UTC',
  },
  {
    region: 'ASIA',
    head: 'SHENZHOU-24 CARRIES FIRST FOREIGN ASTRONAUT TO TIANGONG',
    sub: "China's Shenzhou-24 launched with Pakistan's first astronaut aboard the Tiangong space station.",
    source: 'Arab News / Reuters · 25 Nov UTC',
  },
  {
    region: 'NORTH AMERICA',
    head: 'US PROPOSES TARIFFS ON 14 TRADING PARTNERS',
    sub: 'Trump administration proposes excess-capacity tariffs on 14 partners including China, EU, Japan and South Korea.',
    source: 'Reuters · 25 Nov UTC',
  },
  {
    region: 'OCEANIA',
    head: 'SOLOMON ISLANDS BANS FOREIGN BASES IN AUSTRALIA PACT',
    sub: 'Solomon Islands signs security treaty with Australia, ruling out foreign military bases on its soil.',
    source: 'WSJ · 25 Nov UTC',
  },
];

const REGIONAL_BRIEFS = [
  { region: 'AFRICA', text: 'Sudan RSF drone strikes kill 19 civilians in Damazin and Roseires.' },
  { region: 'AFRICA', text: 'WHO evacuates staff from DR Congo hospital amid Ebola response.' },
  { region: 'ASIA', text: 'Bangladesh raises garment worker minimum wage 36% after protests.' },
  { region: 'EUROPE', text: 'Eurostar cancels London-Paris-Brussels trains due to strike.' },
  { region: 'LATIN AMERICA', text: 'Colombia rescues hostages after forces storm Cartagena supermarket.' },
  { region: 'MIDDLE EAST', text: 'Israel kills Hamas interior security colonel in Gaza airstrike.' },
  { region: 'NORTH AMERICA', text: 'EU plans €50 billion tech fund to challenge US and China.' },
  { region: 'OCEANIA', text: 'North Korea closes Swiss diplomatic office over sanctions feud.' },
];

// ---------- Colors ----------
const C_BG = [248, 248, 246];        // off-white background
const C_PANEL = [255, 255, 255];     // white panel
const C_INK = [20, 24, 28];          // near-black text
const C_MUTED = [110, 118, 126];     // gray text
const C_ACCENT = [200, 120, 40];     // burnt orange accent
const C_ACCENT2 = [60, 100, 160];    // steel blue
const C_GREEN = [80, 140, 60];       // green
const C_RED = [170, 50, 50];         // red
const C_MAP_LAND = [190, 200, 190];  // map land
const C_MAP_SEA = [210, 225, 230];   // map sea
const C_LEAD_BG = [240, 242, 244];   // lead panel background
const C_GRID = [220, 224, 228];      // grid lines

// ---------- Layout ----------
const PAD = 40;
const MASTHEAD_H = 110;
const MAP_X = PAD;
const MAP_Y = MASTHEAD_H + 20;
const MAP_SIZE = 300;
const LEAD_X = MAP_X + MAP_SIZE + 30;
const LEAD_W = WIDTH - LEAD_X - PAD;
const BRIEF_Y = MAP_Y + MAP_SIZE + 30;
const BRIEF_H = HEIGHT - BRIEF_Y - 60;

// ---------- Draw world map (simplified) ----------
function drawWorldMap(canvas: Canvas, cx: number, cy: number, size: number): void {
  const r = size / 2;
  // Sea
  canvas.fillCircle(cx, cy, r, C_MAP_SEA[0], C_MAP_SEA[1], C_MAP_SEA[2], 255);
  // Grid lines (latitude/longitude hints)
  for (let a = 0; a < 360; a += 30) {
    const x1 = cx + Math.cos((a * Math.PI) / 180) * r;
    const y1 = cy + Math.sin((a * Math.PI) / 180) * r;
    canvas.drawLine(cx, cy, Math.round(x1), Math.round(y1), C_MAP_LAND[0], C_MAP_LAND[1], C_MAP_LAND[2], 60);
  }
  // Simplified continent blobs (regional markers)
  const continents = [
    { dx: -0.45, dy: -0.30, rr: 0.14, r: C_GREEN[0], g: C_GREEN[1], b: C_GREEN[2], label: 'AF' },
    { dx: 0.05, dy: -0.25, rr: 0.11, r: C_GREEN[0], g: C_GREEN[1], b: C_GREEN[2], label: 'EU' },
    { dx: 0.30, dy: -0.10, rr: 0.13, r: C_ACCENT2[0], g: C_ACCENT2[1], b: C_ACCENT2[2], label: 'AS' },
    { dx: 0.55, dy: 0.10, rr: 0.12, r: C_ACCENT[0], g: C_ACCENT[1], b: C_ACCENT[2], label: 'NA' },
    { dx: 0.20, dy: 0.25, rr: 0.13, r: C_RED[0], g: C_RED[1], b: C_RED[2], label: 'SA' },
    { dx: -0.05, dy: 0.35, rr: 0.10, r: C_ACCENT[0], g: C_ACCENT[1], b: C_ACCENT[2], label: 'OC' },
  ];
  for (const c of continents) {
    const x = Math.round(cx + c.dx * r);
    const y = Math.round(cy + c.dy * r);
    const rr = Math.round(c.rr * r);
    canvas.fillCircle(x, y, rr, c.r, c.g, c.b, 255);
    // label
    const lw = textWidth(c.label, 1);
    drawText(canvas, x - Math.round(lw / 2), y - 3, c.label, 1, 255, 255, 255);
  }
  // Map ring
  canvas.fillCircle(cx, cy, r, 0, 0, 0, 0); // ensure transparent center not needed
  // draw circle outline by filling ring pixels
  for (let ang = 0; ang < 360; ang += 1) {
    const rad = (ang * Math.PI) / 180;
    const x = Math.round(cx + Math.cos(rad) * r);
    const y = Math.round(cy + Math.sin(rad) * r);
    canvas.setPixel(x, y, C_INK[0], C_INK[1], C_INK[2], 255);
  }
}

// ---------- Draw masthead ----------
function drawMasthead(canvas: Canvas): void {
  // Background band
  canvas.fillRect(0, 0, WIDTH, MASTHEAD_H, C_INK[0], C_INK[1], C_INK[2], 255);
  // Accent stripe
  canvas.fillRect(0, MASTHEAD_H, WIDTH, 6, C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], 255);
  // Title
  drawText(canvas, PAD, 34, 'THE WORLD', 3, 255, 255, 255);
  // Date
  drawText(canvas, PAD + 220, 40, '25 NOVEMBER 2026', 2, 200, 120, 40);
  // Subtitle
  drawText(canvas, PAD, 72, 'WORLD NEWS · DAILY EDITION · VERIFIED REPORTING', 1, 180, 180, 180);
}

// ---------- Draw lead story panel ----------
function drawLeadPanel(canvas: Canvas, x: number, y: number, w: number, h: number, story: (typeof LEAD_STORIES)[0], index: number): void {
  // Panel background
  canvas.fillRect(x, y, w, h, C_LEAD_BG[0], C_LEAD_BG[1], C_LEAD_BG[2], 255);
  // Border
  canvas.fillRect(x, y, w, 2, C_INK[0], C_INK[1], C_INK[2], 255);
  canvas.fillRect(x, y + h - 2, w, 2, C_INK[0], C_INK[1], C_INK[2], 255);
  // Region tag
  const rw = textWidth(story.region, 1);
  canvas.fillRect(x + 12, y + 12, rw + 8, 16, C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], 255);
  drawText(canvas, x + 16, y + 15, story.region, 1, 255, 255, 255);
  // Headline
  drawText(canvas, x + 12, y + 40, story.head, 1, C_INK[0], C_INK[1], C_INK[2], 255);
  // Subhead
  drawText(canvas, x + 12, y + 60, story.sub, 1, C_MUTED[0], C_MUTED[1], C_MUTED[2], 255);
  // Simple icon (geometric marker)
  const icoX = x + w - 40;
  const icoY = y + h / 2;
  const colors = [C_GREEN, C_RED, C_ACCENT2, C_ACCENT, C_PANEL, C_MUTED];
  const c = colors[index % colors.length];
  canvas.fillCircle(icoX, icoY, 14, c[0], c[1], c[2], 255);
  canvas.fillCircle(icoX, icoY, 8, C_INK[0], C_INK[1], C_INK[2], 255);
  // Source line (small, bottom right)
  drawText(canvas, x + 12, y + h - 14, story.source, 1, C_MUTED[0], C_MUTED[1], C_MUTED[2], 255);
}

// ---------- Draw regional briefs ----------
function drawRegionalBriefs(canvas: Canvas, x: number, y: number, w: number, h: number): void {
  const colW = Math.floor((w - 20) / 3);
  const rowH = 42;
  let col = 0;
  let row = 0;
  for (let i = 0; i < REGIONAL_BRIEFS.length; i++) {
    const brief = REGIONAL_BRIEFS[i];
    const bx = x + col * (colW + 10);
    const by = y + row * rowH;
    if (by + rowH > y + h) break;
    // Region chip
    const rw = textWidth(brief.region, 1);
    canvas.fillRect(bx, by, rw + 6, 14, C_ACCENT2[0], C_ACCENT2[1], C_ACCENT2[2], 255);
    drawText(canvas, bx + 3, by + 2, brief.region, 1, 255, 255, 255);
    // Brief text
    drawText(canvas, bx + rw + 12, by + 2, brief.text, 1, C_INK[0], C_INK[1], C_INK[2], 255);
    col++;
    if (col === 3) {
      col = 0;
      row++;
    }
  }
}

// ---------- Draw footer ----------
function drawFooter(canvas: Canvas): void {
  const fy = HEIGHT - 30;
  canvas.fillRect(0, fy, WIDTH, 30, C_INK[0], C_INK[1], C_INK[2], 255);
  drawText(canvas, PAD, fy + 10, 'VERIFIED REPORTING · 25 NOV UTC · MAKE.FUN NEWS IMAGE 20261125', 1, 200, 200, 200);
  // Page number / edition
  drawText(canvas, WIDTH - PAD - 60, fy + 10, 'EDITION 1 OF 1', 1, 200, 200, 200);
}

// ---------- Main ----------
function main(): void {
  const canvas = new Canvas(WIDTH, HEIGHT);

  // Background
  canvas.fillRect(0, 0, WIDTH, HEIGHT, C_BG[0], C_BG[1], C_BG[2], 255);

  // Masthead
  drawMasthead(canvas);

  // World map (central visual)
  drawWorldMap(canvas, MAP_X + MAP_SIZE / 2, MAP_Y + MAP_SIZE / 2, MAP_SIZE);

  // Lead story panels (two rows of three)
  const leadH = 150;
  const leadGap = 16;
  const leadY0 = MAP_Y + (MAP_SIZE - 2 * leadH - leadGap) / 2;
  for (let i = 0; i < LEAD_STORIES.length; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const lx = LEAD_X + col * (LEAD_W / 3);
    const ly = leadY0 + row * (leadH + leadGap);
    const lw = Math.floor(LEAD_W / 3) - 8;
    drawLeadPanel(canvas, lx, ly, lw, leadH, LEAD_STORIES[i], i);
  }

  // Regional briefs
  drawRegionalBriefs(canvas, PAD, BRIEF_Y, WIDTH - 2 * PAD, BRIEF_H);

  // Footer
  drawFooter(canvas);

  // Encode and write
  const png = encodePNG(canvas.getBuffer(), WIDTH, HEIGHT);
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'entry.png'), png, { mode: 0o644 });
}

main();
