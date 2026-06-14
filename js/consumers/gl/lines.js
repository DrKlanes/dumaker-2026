// ═══════════════════════════════════════════════════════════════════
// LÍNEAS DE ESTRUCTURA con temblor continuo (Fase 2) — DOM/SVG, fuera de
// WebGL. Las 4 separadoras internas (border-top entre .strip) + el marco
// (.page border) vibran sin parar, sutil, tipo señal de vídeo viva (NO
// reactivo al scroll). No confundir con el temblor del borde de las cards
// (ese vive en el shader WebGL).
//
// Montaje (cero diffs en Fase 1): un <svg> overlay en .page con un <path>
// por segmento; un rAF recomputa la "d" de cada path con ruido sutil. El
// borde recto CSS se mantiene por defecto y SOLO se oculta tras el primer
// frame (clase .lines-on) → si este módulo falla, el borde recto queda
// (red de seguridad). Bajo prefers-reduced-motion no se monta (lo gatea
// index.js): borde recto, líneas quietas.
//
// Anclaje: el desplazamiento se atenúa con sin(π·s) hacia los extremos de
// cada segmento → las esquinas del marco y las uniones quedan fijas.
// Calibrable en preset.json/lines (amp, speed, detail, jitter) + ?gl=debug.
// ═══════════════════════════════════════════════════════════════════
import { config } from './config.js';

const NS = 'http://www.w3.org/2000/svg';
const TWO_PI = Math.PI * 2;

export function createLines() {
	const page = document.querySelector('.page');
	if (!page) return null;
	const strips = [...page.querySelectorAll(':scope > .strip')];
	if (strips.length < 2) return null;

	const cs = getComputedStyle(page);
	const ink = cs.getPropertyValue('--ink').trim() || '#1a1a1a';
	const hair = parseFloat(cs.getPropertyValue('--hairline')) || 1;

	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('aria-hidden', 'true');
	svg.dataset.lines = '';
	svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible';

	// oculta el borde recto CSS solo cuando el temblor está activo (.lines-on)
	const style = document.createElement('style');
	style.dataset.lines = '';
	style.textContent = '.page.lines-on>.strip+.strip{border-top-color:transparent}.page.lines-on{border-color:transparent}';
	document.head.append(style);
	page.append(svg);

	const segs = []; // { el, axis:'y'|'x', x1,y1,x2,y2, phase }
	function makePath(phase) {
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('fill', 'none');
		p.setAttribute('stroke', ink);
		p.setAttribute('stroke-width', hair);
		p.setAttribute('vector-effect', 'non-scaling-stroke');
		svg.append(p);
		return { el: p, axis: 'y', x1: 0, y1: 0, x2: 0, y2: 0, phase };
	}

	const internal = strips.length - 1;      // separadoras internas
	for (let i = 0; i < internal + 4; i++) segs.push(makePath(i * 1.3)); // +4 = marco

	function measure() {
		const W = page.clientWidth, H = page.clientHeight;
		for (let i = 0; i < internal; i++) {
			const y = strips[i + 1].offsetTop; // top de cada strip a partir del 2º
			Object.assign(segs[i], { axis: 'y', x1: 0, y1: y, x2: W, y2: y });
		}
		const f = internal; // marco: top, bottom, left, right
		Object.assign(segs[f],     { axis: 'y', x1: 0, y1: 0, x2: W, y2: 0 });
		Object.assign(segs[f + 1], { axis: 'y', x1: 0, y1: H, x2: W, y2: H });
		Object.assign(segs[f + 2], { axis: 'x', x1: 0, y1: 0, x2: 0, y2: H });
		Object.assign(segs[f + 3], { axis: 'x', x1: W, y1: 0, x2: W, y2: H });
	}
	measure();

	let raf = 0, presented = false, stopped = false;

	function buildD(seg, t, c) {
		const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
		const N = Math.max(8, Math.round(len / 40));
		let d = '';
		for (let i = 0; i <= N; i++) {
			const s = i / N;
			let x = seg.x1 + (seg.x2 - seg.x1) * s;
			let y = seg.y1 + (seg.y2 - seg.y1) * s;
			const env = Math.sin(Math.PI * s); // ancla extremos / esquinas
			const disp = c.amp * env * (
				Math.sin(s * c.detail * TWO_PI + t * c.speed + seg.phase) * 0.6 +
				Math.sin(s * c.detail * 1.7 * TWO_PI - t * c.speed * 1.3 + seg.phase) * 0.25 +
				(Math.random() - 0.5) * c.jitter // jitter de "señal" (alta frecuencia)
			);
			if (seg.axis === 'y') y += disp; else x += disp;
			d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
		}
		return d;
	}

	function frame(now) {
		if (stopped) return;
		const c = config.lines;
		if (c) {
			const t = now / 1000;
			for (const seg of segs) seg.el.setAttribute('d', buildD(seg, t, c));
			if (!presented) {
				presented = true;
				page.classList.add('lines-on'); // oculta el borde recto
			}
		}
		raf = requestAnimationFrame(frame);
	}

	const ro = new ResizeObserver(() => measure());
	ro.observe(page);
	raf = requestAnimationFrame(frame);

	return {
		stop() {
			stopped = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			page.classList.remove('lines-on');
			svg.remove();
			style.remove();
		},
	};
}
