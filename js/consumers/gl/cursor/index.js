// ═══════════════════════════════════════════════════════════════════
// CURSOR CINÉTICO (Fase 2) — reemplaza el cursor nativo en desktop con
// puntero fino. Ortogonal al carrusel: canvas propio (fixed, viewport),
// contexto GL propio, loop propio. NO toca centerline ni el canvas del
// track. Reutiliza la materia del efecto-firma (grano PNG + value-noise +
// hash + config.grain + reloj a config.grain.clockFps).
//
// Comportamiento:
//  · reposo: cuadrado sólido PEGADO al ratón (sin lag), color cursor.color.
//  · al mover: estela de specks de grano que se disuelven a ritmos
//    distintos (ttl aleatorio) sobre noise turbulento.
//  · sobre interactivos: el cuadrado vira a config.tint.color (rojo de
//    marca) y crece (size→hoverSize) con ease-in-out (cursor.easeMs).
//  · reduced-motion: SIN estela; cuadrado + viraje + crecimiento se quedan.
//
// Red de seguridad: el cursor nativo (cursor:none) solo se oculta tras el
// primer frame presentado; cualquier fallo o contexto perdido lo restaura.
// Loop con sueño: solo renderiza con actividad (mover / estela / ease).
// ═══════════════════════════════════════════════════════════════════
import { createGL } from '../lib/minigl.js';
import { makeGrainTexture, makeNoiseTexture } from '../textures.js';
import { config } from '../config.js';
import { VERT, FRAG } from './shader.js';

// elementos que disparan el viraje rojo + crecimiento (sin tocar el HTML)
const INTERACTIVE = 'a, button, [role="button"], .card, [data-cursor]';
const MAX_SPECKS = 300;  // cap de seguridad del pool ante movimiento muy rápido
const SPECK_SCALE = 1.4; // el speck es un pelín mayor que el cuadrado (cuerpo)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

export async function createCursor({ reduced }) {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.dataset.glCursor = '';
	canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
	document.body.append(canvas);

	const mgl = createGL(canvas);
	if (!mgl) { canvas.remove(); return null; }

	// oculta el cursor nativo SOLO con esta clase en <html> (se activa tras
	// el primer frame; se retira ante cualquier fallo → nativo de vuelta)
	const style = document.createElement('style');
	style.dataset.glCursor = '';
	style.textContent = 'html.gl-cursor-on,html.gl-cursor-on *{cursor:none!important}';
	document.head.append(style);

	let grainTex, noiseTex, prog;
	try {
		grainTex = await makeGrainTexture(mgl);
		noiseTex = makeNoiseTexture(mgl);
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
	let emitX = mx, emitY = my;
	let hovering = false;
	// ease del cuadrado (tamaño + color) con smoothstep temporal
	let curSize = config.cursor.size;
	let curColor = config.cursor.color.slice();
	let fromSize = curSize, toSize = curSize;
	let fromColor = curColor.slice(), toColor = config.cursor.color;
	let easeT0 = -1e9;
	const specks = [];
	let grainSeed = [0.31, 0.74], lastGrain = 0;
	let raf = 0, running = false, presented = false, stopped = false;

	function setHover(next) {
		if (next === hovering) return;
		hovering = next;
		fromSize = curSize;
		fromColor = curColor.slice();
		toSize = next ? config.cursor.hoverSize : config.cursor.size;
		toColor = next ? config.tint.color : config.cursor.color;
		easeT0 = performance.now();
		wake();
	}

	function emitTrail(nx, ny) {
		if (emitX < -9e3) { emitX = nx; emitY = ny; return; }
		const dx = nx - emitX, dy = ny - emitY;
		const dist = Math.hypot(dx, dy) / dprBuf; // px CSS
		const n = Math.min(MAX_SPECKS, Math.floor(dist * config.cursor.trailDensity));
		if (n <= 0) return;
		const now = performance.now();
		const jit = config.cursor.size * dprBuf;
		for (let i = 1; i <= n && specks.length < MAX_SPECKS; i++) {
			const t = i / n;
			specks.push({
				x: emitX + dx * t + (Math.random() - 0.5) * jit,
				y: emitY + dy * t + (Math.random() - 0.5) * jit,
				t0: now,
				ttl: config.cursor.trailTtl * (1 - Math.random() * config.cursor.trailVar),
				seed: Math.random() * 1000,
			});
		}
		emitX = nx; emitY = ny;
	}

	function onMove(e) {
		mx = e.clientX * dprBuf;
		my = e.clientY * dprBuf;
		if (reduced) { emitX = mx; emitY = my; } else emitTrail(mx, my);
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

	function drawQuadAt(cx, cy, sizeCss, mode, color, alpha, seed) {
		const s = sizeCss * dprBuf;
		prog.u4f('uRect', cx - s / 2, cy - s / 2, s, s);
		prog.u1i('uMode', mode);
		prog.u3f('uColor', color[0], color[1], color[2]);
		prog.u1f('uAlpha', alpha);
		if (mode === 1) prog.u1f('uSeed', seed);
		mgl.drawQuad();
	}

	function frame() {
		if (stopped) return;
		const now = performance.now();
		if (!reduced && now - lastGrain > 1000 / (config.grain.clockFps || 16)) {
			grainSeed = [Math.random(), Math.random()];
			lastGrain = now;
		}
		// ease del cuadrado (tamaño + color)
		const e = smooth((now - easeT0) / config.cursor.easeMs);
		curSize = fromSize + (toSize - fromSize) * e;
		for (let i = 0; i < 3; i++) curColor[i] = fromColor[i] + (toColor[i] - fromColor[i]) * e;
		// retira specks muertos
		for (let i = specks.length - 1; i >= 0; i--) {
			if (now - specks[i].t0 >= specks[i].ttl) specks.splice(i, 1);
		}

		mgl.frame(W, H);
		prog.use();
		mgl.bind(grainTex, 0); prog.u1i('uGrain', 0);
		mgl.bind(noiseTex, 1); prog.u1i('uNoise', 1);
		prog.u2f('uRes', W, H);
		prog.u2f('uGrainSeed', grainSeed[0], grainSeed[1]);
		prog.u1f('uGrainAmount', config.grain.amount);
		prog.u1f('uGrainBoost', config.grain.boost);
		prog.u1f('uGrainSize', config.grain.size);
		prog.u1f('uTurb', config.cursor.turbulence);

		// estela (debajo del cuadrado); el rojo de hover NO la afecta
		if (!reduced) {
			for (const sp of specks) {
				drawQuadAt(sp.x / dprBuf, sp.y / dprBuf, config.cursor.size * SPECK_SCALE,
					1, config.cursor.color, 1 - (now - sp.t0) / sp.ttl, sp.seed);
			}
		}
		// cuadrado base, pegado al ratón (sin lag)
		if (mx > -9e3) drawQuadAt(mx / dprBuf, my / dprBuf, curSize, 0, curColor, 1, 0);

		if (!presented) {
			presented = true;
			document.documentElement.classList.add('gl-cursor-on'); // oculta el nativo
		}

		const moved = mx !== pmx || my !== pmy;
		pmx = mx; pmy = my;
		const easing = now - easeT0 < config.cursor.easeMs;
		if (moved || easing || specks.length) raf = requestAnimationFrame(frame);
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

	// contexto perdido → cursor nativo de vuelta al instante (no re-monta:
	// degradación segura; el contexto del cursor casi nunca se pierde)
	canvas.addEventListener('webglcontextlost', (ev) => {
		ev.preventDefault();
		cancelAnimationFrame(raf);
		running = false;
		document.documentElement.classList.remove('gl-cursor-on');
	});

	wake(); // primer frame → activa cursor:none
	return { stop: teardown };
}
