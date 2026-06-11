// One-off de desarrollo: genera las texturas de grano base (Fase 1).
// PNG tileable 256x256, sin dependencias (encoder PNG mínimo + zlib de Node).
// Diana de intensidad (Figma): noise Mono, size 0.8, densidad ~23%, opacidad 25-44%.
// La opacidad final se calibra en CSS; aquí se hornea densidad + alpha base.
// Uso: node tools/generate-grain.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 256;

// PRNG con semilla fija: texturas reproducibles entre regeneraciones
function mulberry32(seed) {
	return function () {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xFFFFFFFF;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
	return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, w, h) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // color type RGBA
	// scanlines con filter byte 0
	const raw = Buffer.alloc(h * (1 + w * 4));
	for (let y = 0; y < h; y++) {
		rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function grain({ name, seed, rgb, density, alphaMin, alphaMax }) {
	const rand = mulberry32(seed);
	const px = Buffer.alloc(SIZE * SIZE * 4);
	for (let i = 0; i < SIZE * SIZE; i++) {
		const o = i * 4;
		px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
		px[o + 3] = rand() < density ? Math.round(alphaMin + rand() * (alphaMax - alphaMin)) : 0;
	}
	const png = encodePNG(px, SIZE, SIZE);
	writeFileSync(new URL(`../assets/textures/${name}`, import.meta.url), png);
	console.log(`${name}: ${png.length} bytes`);
}

// Grano blanco → sustratos oscuros (marco negro, cards oscuras)
grain({ name: 'grain-light.png', seed: 20261, rgb: [255, 255, 255], density: 0.23, alphaMin: 70, alphaMax: 190 });
// Grano tinta → sustrato claro (#ebebeb), más contenido
grain({ name: 'grain-dark.png', seed: 20262, rgb: [10, 9, 8], density: 0.23, alphaMin: 45, alphaMax: 120 });
