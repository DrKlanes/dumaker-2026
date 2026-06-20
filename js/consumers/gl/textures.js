// Texturas de la capa GL: media (imagen/vídeo), labels rasterizados
// desde el DOM vivo (medidas y line-breaks reales, no reimplementados),
// el PNG de grano de Fase 1 y el value-noise precomputado.

// ── ruido tileable 256² RGBA (4 fases, una por canal) ────────────────
export function makeNoiseTexture(mgl) {
	const S = 256;
	const G = 32; // rejilla base tileable
	const data = new Uint8Array(S * S * 4);
	for (let ch = 0; ch < 4; ch++) {
		const grid = new Float32Array(G * G);
		for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
		for (let y = 0; y < S; y++) {
			for (let x = 0; x < S; x++) {
				const gx = (x / S) * G;
				const gy = (y / S) * G;
				const x0 = Math.floor(gx) % G, y0 = Math.floor(gy) % G;
				const x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
				const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
				const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
				const v =
					grid[y0 * G + x0] * (1 - sx) * (1 - sy) + grid[y0 * G + x1] * sx * (1 - sy) +
					grid[y1 * G + x0] * (1 - sx) * sy + grid[y1 * G + x1] * sx * sy;
				data[(y * S + x) * 4 + ch] = v * 255;
			}
		}
	}
	const t = mgl.createTexture({ wrap: mgl.gl.REPEAT });
	mgl.uploadData(t, data, S, S);
	return t;
}

export async function makeGrainTexture(mgl) {
	const img = new Image();
	img.src = 'assets/textures/grain-light.png';
	await img.decode();
	const t = mgl.createTexture({ wrap: mgl.gl.REPEAT, filter: mgl.gl.NEAREST });
	mgl.upload(t, img);
	return t;
}

// textura grunge (escala de grises) para el overlay de mugre del pase de
// lente. CLAMP_TO_EDGE: nunca tilea — el muestreo se mantiene dentro del
// interior por el margen de seguridad (zoom + offset acotado en cardsLayer).
export async function makeGrungeTexture(mgl) {
	const img = new Image();
	img.src = 'assets/textures/texture-grunge.webp';
	try { await img.decode(); } catch { return null; } // opcional: si falta, sin grunge (GL viva)
	const t = mgl.createTexture({ wrap: mgl.gl.CLAMP_TO_EDGE, filter: mgl.gl.LINEAR });
	mgl.upload(t, img);
	return t;
}

// textura sólida 1×1 — el fondo de la card de texto (color sólido) pasa
// por el MISMO camino de media que las imágenes (elimina la rama especial)
export function makeSolidTexture(mgl, rgba) {
	const t = mgl.createTexture();
	mgl.uploadData(t, new Uint8Array(rgba), 1, 1);
	return t;
}

// ── media ─────────────────────────────────────────────────────────────
// Vía new Image(): las <img> del DOM llevan loading="lazy" y las
// instancias fuera de viewport jamás cargan — su decode() colgaría el
// boot para siempre. La caché HTTP hace esta carga paralela gratis.
export async function loadMediaTexture(mgl, instanceEl) {
	const img = instanceEl.querySelector('.card__media img');
	const src = img?.currentSrc || img?.getAttribute('src');
	if (!src) return null;
	const loader = new Image();
	loader.src = src;
	try {
		await loader.decode();
	} catch {
		return null;
	}
	const t = mgl.createTexture();
	mgl.upload(t, loader);
	return t;
}

// LITE: el clip se trata como imagen — su media es el PRIMER frame del vídeo
// (textura estática, sin reproducción ni upload por frame). Usa el <video>
// del DOM (en el árbol → decodifica fiable en iOS); loadeddata = frame 0
// disponible. Tope de 9s: si no llega, devuelve null → fondo de card.
export async function loadVideoFrameTexture(mgl, instanceEl) {
	const v = instanceEl.querySelector('video');
	const src = v?.dataset.src || v?.getAttribute('src');
	if (!v || !src) return null;
	if (!v.src) v.src = src;
	v.muted = true;
	v.preload = 'auto';
	try {
		await new Promise((res, rej) => {
			if (v.readyState >= 2) return res();
			const cleanup = () => {
				clearTimeout(timer);
				v.removeEventListener('loadeddata', onData);
				v.removeEventListener('error', onErr);
			};
			const onData = () => { cleanup(); res(); };
			const onErr = () => { cleanup(); rej(new Error('video')); };
			const timer = setTimeout(() => { cleanup(); v.readyState >= 2 ? res() : rej(new Error('timeout')); }, 9000);
			v.addEventListener('loadeddata', onData);
			v.addEventListener('error', onErr);
			v.load();
		});
	} catch {
		return null;
	}
	const t = mgl.createTexture();
	mgl.upload(t, v); // texImage2D del frame 0, una sola vez (sin play)
	return t;
}

export function coverMapping(texW, texH, boxW, boxH) {
	const texA = texW / texH;
	const boxA = boxW / boxH;
	if (texA > boxA) {
		const sx = boxA / texA;
		return { s: [sx, 1], o: [(1 - sx) / 2, 0] };
	}
	const sy = texA / boxA;
	return { s: [1, sy], o: [0, (1 - sy) / 2] };
}

// ── vídeo: subida solo en frame nuevo (RVFC), rebind por instancia ────
export function createVideoFeed(mgl) {
	const feeds = new Map(); // logicalIndex -> { el, tex, fresh }

	function bind(index, videoEl) {
		let feed = feeds.get(index);
		if (feed && feed.el === videoEl) return feed;
		if (!feed) {
			feed = { el: null, tex: mgl.createTexture(), fresh: false };
			feeds.set(index, feed);
		}
		feed.el = videoEl;
		feed.fresh = false;
		const arm = () => {
			if (feed.el !== videoEl) return; // rebind: cadena vieja muere
			feed.fresh = true;
			if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(arm);
		};
		if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(arm);
		else feed.fresh = true; // fallback: subir por render tick
		return feed;
	}

	function texFor(index, videoEl) {
		const feed = bind(index, videoEl);
		if (videoEl.readyState >= 2 && (feed.fresh || !feed.tex.ready)) {
			mgl.upload(feed.tex, videoEl);
			if (videoEl.requestVideoFrameCallback) feed.fresh = false;
		}
		return feed.tex.ready ? feed.tex : null;
	}

	return { texFor };
}

// ── labels: rasterización desde el DOM vivo ───────────────────────────
// Extrae las líneas REALES renderizadas (Range.getClientRects) de los
// bloques de texto de la card y las dibuja con las métricas computadas.
function extractLines(rootEl) {
	const lines = [];
	const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
	let node;
	while ((node = walker.nextNode())) {
		const text = node.textContent;
		if (!text.trim()) continue;
		const style = getComputedStyle(node.parentElement);
		const range = document.createRange();
		let lineStart = 0;
		let lastCount = 0;
		for (let i = 1; i <= text.length; i++) {
			range.setStart(node, lineStart);
			range.setEnd(node, i);
			const count = range.getClientRects().length;
			if (count > lastCount && lastCount > 0) {
				// el carácter i-1 abre línea nueva: cerrar la anterior
				range.setEnd(node, i - 1);
				const r = range.getBoundingClientRect();
				lines.push({ text: text.slice(lineStart, i - 1), rect: r, style });
				lineStart = i - 1;
				lastCount = 1;
			} else {
				lastCount = Math.max(lastCount, count);
			}
		}
		if (lineStart < text.length) {
			range.setStart(node, lineStart);
			range.setEnd(node, text.length);
			const r = range.getBoundingClientRect();
			lines.push({ text: text.slice(lineStart), rect: r, style });
		}
	}
	return lines;
}

export function rasterizeLabel(mgl, instanceEl, scale) {
	const cardRect = instanceEl.getBoundingClientRect();
	const w = Math.max(2, Math.round(cardRect.width * scale));
	const h = Math.max(2, Math.round(cardRect.height * scale));
	const cnv = document.createElement('canvas');
	cnv.width = w;
	cnv.height = h;
	const ctx = cnv.getContext('2d');
	ctx.scale(scale, scale);

	// fondos de los badges del escaparate lab: rasterizeLabel solo pinta texto,
	// así que las cajas de color van aquí (la card las trae como .card__badge,
	// HARDCODED a lab). Gateado a esos elementos → el resto de cards no tiene
	// ninguno → cero efecto. Se dibujan antes del texto para que quede encima.
	for (const b of instanceEl.querySelectorAll('.card__badge')) {
		const bs = getComputedStyle(b);
		const br = b.getBoundingClientRect();
		const bx = br.left - cardRect.left;
		const by = br.top - cardRect.top;
		const rad = parseFloat(bs.borderTopLeftRadius) || 0;
		ctx.fillStyle = bs.backgroundColor;
		if (rad && ctx.roundRect) {
			ctx.beginPath();
			ctx.roundRect(bx, by, br.width, br.height, rad);
			ctx.fill();
		} else {
			ctx.fillRect(bx, by, br.width, br.height);
		}
	}

	const blocks = instanceEl.querySelectorAll('.card__title, .card__sub, .card__badge');
	for (const block of blocks) {
		for (const line of extractLines(block)) {
			const s = line.style;
			let text = line.text;
			if (s.textTransform === 'uppercase') text = text.toUpperCase();
			ctx.font = `${s.fontWeight} ${s.fontSize} "Chivo Mono", monospace`;
			ctx.fillStyle = s.color;
			const canLS = 'letterSpacing' in ctx;
			if (canLS) ctx.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
			ctx.textBaseline = 'alphabetic';
			// baseline real del line box: half-leading + ascent
			const m = ctx.measureText('Hg');
			const ascent = m.fontBoundingBoxAscent ?? parseFloat(s.fontSize) * 0.8;
			const descent = m.fontBoundingBoxDescent ?? parseFloat(s.fontSize) * 0.2;
			const half = (line.rect.height - (ascent + descent)) / 2;
			const x = line.rect.left - cardRect.left;
			const y = line.rect.top - cardRect.top + half + ascent;
			if (canLS) {
				ctx.fillText(text, x, y);
			} else {
				// fallback sin API letterSpacing: avance manual (mono = trivial)
				const ls = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing);
				const adv = ctx.measureText('0').width + ls;
				for (let c = 0; c < text.length; c++) ctx.fillText(text[c], x + c * adv, y);
			}
		}
	}

	// icono de flecha de enlace (equivale a .card__link[href]::after del CSS):
	// el rasterizado roba texto, no pseudo-elementos, así que lo dibujamos aquí
	// para que aparezca también en desktop (en LITE/Fase 1 lo pinta el ::after).
	const link = instanceEl.querySelector('.card__link[href]');
	const textEl = link && (link.querySelector('[data-slot="title"]') || link);
	const rects = textEl && textEl.getClientRects();
	const last = rects && rects[rects.length - 1];
	if (last) {
		const s = getComputedStyle(link);
		const fs = parseFloat(s.fontSize);
		ctx.font = `${s.fontWeight} ${s.fontSize} "Chivo Mono", monospace`;
		const m = ctx.measureText('Hg');
		const ascent = m.fontBoundingBoxAscent ?? fs * 0.8;
		const descent = m.fontBoundingBoxDescent ?? fs * 0.2;
		const half = (last.height - (ascent + descent)) / 2;
		const baseline = (last.top - cardRect.top) + half + ascent;
		const sz = fs * 0.7;                            // width/height 0.7em
		const ix = (last.right - cardRect.left) + fs * 0.25; // margin-left 0.25em
		const iy = baseline - fs * 0.15 - sz;           // vertical-align 0.15em
		const k = sz / 16;                              // viewBox 16 → sz px (contain)
		ctx.save();
		ctx.fillStyle = s.color;                        // = currentColor del título
		ctx.translate(ix, iy);
		ctx.scale(k, k);
		ctx.translate(3, 3);                            // transform="translate(3 3)" del SVG
		ctx.fill(new Path2D('m2 0v2h4.5l-6.5 6.5 1.5 1.5 6.5-6.5v4.5h2v-8z'));
		ctx.restore();
	}

	const t = mgl.createTexture();
	mgl.upload(t, cnv);
	return t;
}

// fuentes que el rasterizado necesita, cargadas explícitamente
export function loadLabelFonts() {
	return Promise.all([
		document.fonts.load('200 22px "Chivo Mono"'),
		document.fonts.load('700 22px "Chivo Mono"'),
		document.fonts.load('400 12px "Chivo Mono"'),
	]).catch(() => {});
}
