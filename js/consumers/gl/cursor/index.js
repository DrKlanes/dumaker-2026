// ═══════════════════════════════════════════════════════════════════
// CURSOR CINÉTICO (Fase 2) — reemplaza el cursor nativo en desktop con
// puntero fino. Ortogonal al carrusel: canvas propio (fixed, viewport),
// contexto GL propio, loop propio. NO toca centerline ni el canvas del
// track. Reutiliza la materia del efecto-firma (PNG de grano + hash +
// config.grain + reloj a config.grain.clockFps).
//
//  · reposo: cuadrado sólido PEGADO al ratón (sin lag), color cursor.color.
//  · al mover: ENJAMBRE de puntos diminutos de grano (gl.POINTS), tamaño
//    variable, cola larga de persistencia (trailTail → unos quedan
//    anclados), grano táctil del PNG, decay no lineal. Anclados en coords
//    de viewport donde se soltaron.
//  · sobre interactivos: el cuadrado crece (size→hoverSize, ease-in-out) y
//    gana borde de contraste (B, nunca se pierde); el relleno vira a rojo
//    de marca, o a blanco (hoverColorAlt) sobre superficies rojas (A:
//    .card--texto), intercambiando relleno/borde.
//  · reduced-motion: SIN estela; cuadrado + viraje + crecimiento se quedan.
//
// Red de seguridad: cursor:none se activa SOLO tras el primer frame; fallo
// de boot o webglcontextlost lo retira → el cursor nativo vuelve.
// ═══════════════════════════════════════════════════════════════════
import { createGL } from '../lib/minigl.js';
import { makeGrainTexture } from '../textures.js';
import { config } from '../config.js';
import { SQUARE_VERT, SQUARE_FRAG, POINTS_VERT, POINTS_FRAG } from './shader.js';

const INTERACTIVE = 'a, button, [role="button"], .card, [data-cursor]';
const RED = '.card--texto';   // superficie roja entera (viraje a blanco, A)
const MAX_SPECKS = 4000;      // cap del enjambre (un solo draw-call igualmente)
const STRIDE = 5;             // floats por punto: x, y, size, life, seed

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
	const gl = mgl.gl;

	// oculta el cursor nativo SOLO con esta clase en <html> (tras el 1er
	// frame; se retira ante cualquier fallo → cursor nativo de vuelta)
	const style = document.createElement('style');
	style.dataset.glCursor = '';
	style.textContent = 'html.gl-cursor-on,html.gl-cursor-on *{cursor:none!important}';
	document.head.append(style);

	let grainTex, square, points, pointsVAO, pointsBuf, pData;
	try {
		grainTex = await makeGrainTexture(mgl);
		square = mgl.createProgram(SQUARE_VERT, SQUARE_FRAG);
		points = mgl.createProgram(POINTS_VERT, POINTS_FRAG);
		// VAO/buffer dinámico del enjambre (gl crudo; aPos en loc 0 por minigl)
		pData = new Float32Array(MAX_SPECKS * STRIDE);
		pointsVAO = gl.createVertexArray();
		pointsBuf = gl.createBuffer();
		gl.bindVertexArray(pointsVAO);
		gl.bindBuffer(gl.ARRAY_BUFFER, pointsBuf);
		gl.bufferData(gl.ARRAY_BUFFER, pData.byteLength, gl.DYNAMIC_DRAW);
		const bytes = STRIDE * 4;
		const set = (name, size, off) => {
			const l = name === 'aPos' ? 0 : gl.getAttribLocation(points.prog, name);
			gl.enableVertexAttribArray(l);
			gl.vertexAttribPointer(l, size, gl.FLOAT, false, bytes, off);
		};
		set('aPos', 2, 0); set('aSize', 1, 8); set('aLife', 1, 12); set('aSeed', 1, 16);
		gl.bindVertexArray(null);
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
	let hovering = false, onRed = false;
	// ease del cuadrado (tamaño + color de relleno + grosor de borde)
	let curSize = config.cursor.size;
	let curColor = config.cursor.color.slice();
	let curEdgeW = 0;
	let fromSize = curSize, toSize = curSize;
	let fromColor = curColor.slice(), toColor = config.cursor.color;
	let fromEdgeW = 0, toEdgeW = 0;
	let edgeColor = config.cursor.hoverColorAlt;
	let easeT0 = -1e9;
	const specks = [];
	let grainSeed = [0.31, 0.74], lastGrain = 0;
	let raf = 0, running = false, presented = false, stopped = false;

	function setHover(next, red) {
		if (next === hovering && red === onRed) return;
		hovering = next;
		onRed = red;
		fromSize = curSize;
		fromColor = curColor.slice();
		fromEdgeW = curEdgeW;
		if (next) {
			toSize = config.cursor.hoverSize;
			toEdgeW = config.cursor.edgeWidth;
			// A: sobre rojo el relleno va a blanco; el borde toma el opuesto
			toColor = red ? config.cursor.hoverColorAlt : config.tint.color;
			edgeColor = red ? config.tint.color : config.cursor.hoverColorAlt;
		} else {
			toSize = config.cursor.size;
			toEdgeW = 0;
			toColor = config.cursor.color;
		}
		easeT0 = performance.now();
		wake();
	}

	function emitTrail(nx, ny) {
		if (emitX < -9e3) { emitX = nx; emitY = ny; return; }
		const c = config.cursor;
		const dx = nx - emitX, dy = ny - emitY;
		const n = Math.floor((Math.hypot(dx, dy) / dprBuf) * c.trailDensity);
		if (n <= 0) return; // acumula distancia (no toca emitX) hasta ≥1 punto
		const now = performance.now();
		const jit = c.jitter * dprBuf;
		for (let i = 1; i <= n && specks.length < MAX_SPECKS; i++) {
			const t = i / n;
			// cola larga: la fracción trailTail vive 3–8× más (anclado)
			const ttl = Math.random() < c.trailTail
				? c.trailTtl * (3 + Math.random() * 5)
				: c.trailTtl * (0.35 + Math.random() * 0.6);
			const size = Math.max(1, c.speckSize * (1 + (Math.random() * 2 - 1) * c.speckSizeVar)) * dprBuf;
			specks.push({
				x: emitX + dx * t + (Math.random() - 0.5) * jit,
				y: emitY + dy * t + (Math.random() - 0.5) * jit,
				size, t0: now, ttl, seed: Math.random(),
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
		const hit = e.target.closest?.(INTERACTIVE);
		if (hit) setHover(true, !!hit.closest(RED));
	}
	function onOut(e) {
		const to = e.relatedTarget;
		if (!to || !to.closest?.(INTERACTIVE)) setHover(false, false);
	}

	addEventListener('pointermove', onMove, { passive: true });
	addEventListener('pointerover', onOver, { passive: true });
	addEventListener('pointerout', onOut, { passive: true });
	addEventListener('resize', resize);

	function frame() {
		if (stopped) return;
		const now = performance.now();
		if (!reduced && now - lastGrain > 1000 / (config.grain.clockFps || 16)) {
			grainSeed = [Math.random(), Math.random()];
			lastGrain = now;
		}
		// ease del cuadrado
		const e = smooth((now - easeT0) / config.cursor.easeMs);
		curSize = fromSize + (toSize - fromSize) * e;
		curEdgeW = fromEdgeW + (toEdgeW - fromEdgeW) * e;
		for (let i = 0; i < 3; i++) curColor[i] = fromColor[i] + (toColor[i] - fromColor[i]) * e;

		mgl.frame(W, H);

		// ── estela: enjambre de puntos (compacta vivos + 1 draw-call) ──
		let n = 0;
		if (!reduced && specks.length) {
			let w = 0;
			for (let i = 0; i < specks.length; i++) {
				const sp = specks[i];
				const life = (now - sp.t0) / sp.ttl;
				if (life >= 1) continue;
				specks[w++] = sp;
				pData[n * STRIDE] = sp.x; pData[n * STRIDE + 1] = sp.y;
				pData[n * STRIDE + 2] = sp.size; pData[n * STRIDE + 3] = life;
				pData[n * STRIDE + 4] = sp.seed;
				n++;
			}
			specks.length = w;
		}
		if (n) {
			points.use();
			mgl.bind(grainTex, 0); points.u1i('uGrain', 0);
			points.u2f('uRes', W, H);
			points.u2f('uGrainSeed', grainSeed[0], grainSeed[1]);
			points.u1f('uGrainSize', config.grain.size);
			points.u1f('uGrainAmount', config.grain.amount);
			points.u3f('uColor', config.cursor.color[0], config.cursor.color[1], config.cursor.color[2]);
			gl.bindVertexArray(pointsVAO);
			gl.bindBuffer(gl.ARRAY_BUFFER, pointsBuf);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, pData.subarray(0, n * STRIDE));
			gl.drawArrays(gl.POINTS, 0, n);
			gl.bindVertexArray(null);
		}

		// ── cuadrado base, pegado al ratón (encima de la estela) ──
		if (mx > -9e3) {
			const s = curSize * dprBuf;
			square.use();
			square.u2f('uRes', W, H);
			square.u4f('uRect', mx - s / 2, my - s / 2, s, s);
			square.u3f('uColor', curColor[0], curColor[1], curColor[2]);
			square.u3f('uEdgeColor', edgeColor[0], edgeColor[1], edgeColor[2]);
			square.u1f('uEdgeW', curEdgeW);
			square.u1f('uAlpha', 1);
			mgl.drawQuad();
		}

		if (!presented) {
			presented = true;
			document.documentElement.classList.add('gl-cursor-on'); // oculta el nativo
		}

		const moved = mx !== pmx || my !== pmy;
		pmx = mx; pmy = my;
		const easing = now - easeT0 < config.cursor.easeMs;
		if (moved || easing || n) raf = requestAnimationFrame(frame);
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
