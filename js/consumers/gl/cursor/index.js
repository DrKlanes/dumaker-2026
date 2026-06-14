// ═══════════════════════════════════════════════════════════════════
// CURSOR CINÉTICO (Fase 2) — reemplaza el cursor nativo en desktop con
// puntero fino. Ortogonal al carrusel: canvas propio (fixed, viewport),
// contexto GL propio, loop propio. NO toca centerline ni el carrusel.
//
//  · cuadrado sólido PEGADO al ratón (sin lag, sin rastro, sin borde).
//  · reposo: rojo de marca (cursor.color).
//  · hover sobre cualquier interactivo: vira a blanco (cursor.hoverColor)
//    y crece (size→hoverSize) con ease-in-out (cursor.easeMs). Siempre,
//    sin excepciones de superficie.
//
// Red de seguridad: cursor:none se activa SOLO tras el primer frame; un
// fallo de boot o webglcontextlost lo retira → el cursor nativo vuelve.
// Loop con sueño: solo renderiza con actividad (mover / ease en curso).
// ═══════════════════════════════════════════════════════════════════
import { createGL } from '../lib/minigl.js';
import { config } from '../config.js';
import { VERT, FRAG } from './shader.js';

const INTERACTIVE = 'a, button, [role="button"], .card, [data-cursor]';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

export async function createCursor() {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.dataset.glCursor = '';
	canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
	document.body.append(canvas);

	const mgl = createGL(canvas);
	if (!mgl) { canvas.remove(); return null; }

	// oculta el cursor nativo SOLO con esta clase en <html> (tras el 1er
	// frame; se retira ante cualquier fallo → cursor nativo de vuelta)
	const style = document.createElement('style');
	style.dataset.glCursor = '';
	style.textContent = 'html.gl-cursor-on,html.gl-cursor-on *{cursor:none!important}';
	document.head.append(style);

	let prog;
	try {
		prog = mgl.createProgram(VERT, FRAG);
	} catch {
		teardown();
		return null;
	}

	let dprBuf = 1, W = 2, H = 2;
	function resize() {
		dprBuf = Math.min(devicePixelRatio || 1, config.cursor?.dprCap ?? 1);
		W = Math.max(2, Math.round(innerWidth * dprBuf));
		H = Math.max(2, Math.round(innerHeight * dprBuf));
		canvas.width = W;
		canvas.height = H;
	}
	resize();

	let mx = -1e4, my = -1e4, pmx = mx, pmy = my; // px de buffer
	let hovering = false;
	// ease del cuadrado (tamaño + color) con smoothstep temporal
	let curSize = config.cursor.size;
	let curColor = config.cursor.color.slice();
	let fromSize = curSize, toSize = curSize;
	let fromColor = curColor.slice(), toColor = config.cursor.color;
	let easeT0 = -1e9;
	let raf = 0, running = false, presented = false, stopped = false;

	function setHover(next) {
		if (next === hovering) return;
		hovering = next;
		fromSize = curSize;
		fromColor = curColor.slice();
		toSize = next ? config.cursor.hoverSize : config.cursor.size;
		toColor = next ? config.cursor.hoverColor : config.cursor.color;
		easeT0 = performance.now();
		wake();
	}

	function onMove(e) {
		mx = e.clientX * dprBuf;
		my = e.clientY * dprBuf;
		wake();
	}
	function onOver(e) {
		if (e.target.closest?.(INTERACTIVE)) setHover(true);
	}
	function onOut(e) {
		const to = e.relatedTarget;
		if (!to || !to.closest?.(INTERACTIVE)) setHover(false);
	}

	addEventListener('pointermove', onMove, { passive: true });
	addEventListener('pointerover', onOver, { passive: true });
	addEventListener('pointerout', onOut, { passive: true });
	addEventListener('resize', resize);

	function frame() {
		if (stopped) return;
		const now = performance.now();
		const e = smooth((now - easeT0) / config.cursor.easeMs);
		curSize = fromSize + (toSize - fromSize) * e;
		for (let i = 0; i < 3; i++) curColor[i] = fromColor[i] + (toColor[i] - fromColor[i]) * e;

		mgl.frame(W, H);
		if (mx > -9e3) {
			const s = curSize * dprBuf;
			prog.use();
			prog.u2f('uRes', W, H);
			prog.u4f('uRect', mx - s / 2, my - s / 2, s, s);
			prog.u3f('uColor', curColor[0], curColor[1], curColor[2]);
			prog.u1f('uAlpha', 1);
			mgl.drawQuad();
		}

		if (!presented) {
			presented = true;
			document.documentElement.classList.add('gl-cursor-on'); // oculta el nativo
		}

		const moved = mx !== pmx || my !== pmy;
		pmx = mx; pmy = my;
		const easing = now - easeT0 < config.cursor.easeMs;
		if (moved || easing) raf = requestAnimationFrame(frame);
		else running = false; // duerme: el cuadrado queda dibujado en su sitio
	}

	function wake() {
		if (stopped || running) return;
		running = true;
		raf = requestAnimationFrame(frame);
	}

	function teardown() {
		stopped = true;
		cancelAnimationFrame(raf);
		removeEventListener('pointermove', onMove);
		removeEventListener('pointerover', onOver);
		removeEventListener('pointerout', onOut);
		removeEventListener('resize', resize);
		document.documentElement.classList.remove('gl-cursor-on');
		canvas.remove();
		style.remove();
	}

	canvas.addEventListener('webglcontextlost', (ev) => {
		ev.preventDefault();
		cancelAnimationFrame(raf);
		running = false;
		document.documentElement.classList.remove('gl-cursor-on');
	});

	wake(); // primer frame → activa cursor:none
	return { stop: teardown };
}
