// Entrada de la capa cinética (Fase 2). Único módulo que main.js importa.
// Regla heredada: si CUALQUIER paso del boot falla, no se ha ocultado
// nada del DOM → la Fase 1 queda intacta píxel por píxel.
import { config, loadPreset } from './config.js';
import { createGL } from './lib/minigl.js';
import { VERT, frag } from './shaders.js';
import { createDomBridge } from './domBridge.js';
import { createCardsLayer } from './cardsLayer.js';
import { createLens } from './lens.js';
import { createTicker } from './ticker.js';
import { makeNoiseTexture, makeGrainTexture, createVideoFeed, loadLabelFonts } from './textures.js';
import { createCursor } from './cursor/index.js';

export async function init({ centerline, loop, cssBridge }) {
	if (matchMedia('(forced-colors: active)').matches) return;
	if (navigator.connection?.saveData) return;
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

	let profileName = matchMedia('(pointer: coarse)').matches ? 'LITE' : 'FULL';
	// override de desarrollo: ?profile=lite|full (probar el look móvil en desktop)
	const forced = new URLSearchParams(location.search).get('profile');
	if (forced === 'lite' || forced === 'full') profileName = forced.toUpperCase();
	let mgl = null;
	let layer = null;
	let ticker = null;
	let lensTarget = null; // FBO de la escena para el pase de lente global

	const bridge = createDomBridge({
		onLayout() {
			if (!layer) return;
			if (lensTarget && mgl) mgl.resizeTarget(lensTarget, bridge.env.bufferW, bridge.env.bufferH);
			layer.refreshCovers();
			layer.rebuildLabels(bridge.env.sx);
			ticker?.renderOnce();
		},
		onFocusReveal(index) {
			if (!layer) return;
			layer.setHide(index, index >= 0);
			ticker?.renderOnce();
		},
	});

	function applyProfile() {
		const p = config.profiles[profileName];
		bridge.env.dprCap = p.dprCap;
		bridge.env.scale = p.scale;
		// LITE: el texto sale de la GL y se pinta como DOM nítido
		bridge.env.domText = profileName === 'LITE';
	}

	function teardown() {
		ticker?.stop();
		bridge.destroy();
	}

	try {
		await loadPreset();          // única fuente de verdad; si falla → Fase 1 limpia

		// cursor cinético: módulo independiente (canvas/contexto/loop propios).
		// Solo desktop con puntero fino; sin await (no retrasa el carrusel) y
		// se autodesactiva ante cualquier fallo (cursor nativo intacto).
		if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
			createCursor().catch(() => {});
		}

		bridge.env.margin = config.margin;
		applyProfile();
		if (!bridge.measure()) return teardown();

		mgl = createGL(bridge.canvas);
		if (!mgl) return teardown();

		const videoFeed = createVideoFeed(mgl);
		layer = createCardsLayer(mgl, bridge, videoFeed);
		if (layer.initCards() === 0) return teardown();

		let prog = mgl.createProgram(VERT, frag(profileName === 'LITE'));
		layer.setProgram(prog);

		// lente global: SIEMPRE (todos los perfiles) — la composición pasa por
		// el FBO (ruta probada; arregla la invisibilidad de la card de color en
		// la ruta directa). El fisheye solo se aplica en FULL; en LITE la lente
		// es identidad (ver cardsLayer.render).
		lensTarget = mgl.createTarget(bridge.env.bufferW, bridge.env.bufferH);
		layer.setLens(createLens(mgl), lensTarget);

		// el boot jamás se cuelga en silencio: si los assets no llegan, fuera
		const deadline = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout de assets')), 10000));
		const [grainTex] = await Promise.race([
			Promise.all([makeGrainTexture(mgl), loadLabelFonts()]),
			deadline,
		]);
		layer.setStatic(grainTex, makeNoiseTexture(mgl));
		await Promise.race([layer.buildTextures(bridge.env.sx), deadline]);

		ticker = createTicker(centerline, layer, { reduced, onDemote: demote });

		// switch atómico: texturas visibles listas + frame PRESENTADO
		const snap = centerline.getSnapshot();
		const visLimit = (bridge.env.rect.width / bridge.env.slotW) / 2 + 1.2;
		if (!layer.readyFor(snap, visLimit)) {
			await new Promise((r) => setTimeout(r, 300)); // segunda oportunidad
			if (!layer.readyFor(snap, visLimit)) return teardown();
		}
		ticker.renderOnce();
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		ticker.renderOnce(); // con snapshot ya computado: el frame del switch nunca es viejo
		bridge.on();
		cssBridge?.disable(); // nadie consume --dist con la GL activa (one-way, documentado)
		ticker.wake();
	} catch (e) {
		console.warn('gl: desactivada —', e.message);
		return teardown();
	}

	function demote() {
		if (profileName === 'FULL') {
			profileName = 'LITE';
			try {
				applyProfile();              // pone env.domText = true
				bridge.measure();
				layer.setProgram(mgl.createProgram(VERT, frag(true)));
				// se mantiene la lente (identidad en LITE): el FBO arregla la
				// card de color; solo se quita el fisheye visual
				layer.rebuildLabels(bridge.env.sx); // anula labels GL
				bridge.on();                 // reaplica .gl-on + añade .gl-lite (texto DOM)
				ticker.renderOnce();
				console.warn('gl: degradada a LITE (fps sostenidos < 45)');
			} catch {
				teardown();
			}
		} else {
			console.warn('gl: desactivada (LITE insuficiente)');
			teardown();
		}
	}

	// contexto perdido: DOM de vuelta al instante; restaurado: re-init completo
	bridge.canvas.addEventListener('webglcontextlost', (e) => {
		e.preventDefault();
		ticker?.stop();
		bridge.off();
	});
	bridge.canvas.addEventListener('webglcontextrestored', async () => {
		try {
			mgl = createGL(bridge.canvas);
			const videoFeed = createVideoFeed(mgl);
			layer = createCardsLayer(mgl, bridge, videoFeed);
			layer.initCards();
			layer.setProgram(mgl.createProgram(VERT, frag(profileName === 'LITE')));
			lensTarget = mgl.createTarget(bridge.env.bufferW, bridge.env.bufferH);
			layer.setLens(createLens(mgl), lensTarget);
			const [g] = await Promise.all([makeGrainTexture(mgl)]);
			layer.setStatic(g, makeNoiseTexture(mgl));
			await layer.buildTextures(bridge.env.sx);
			ticker = createTicker(centerline, layer, { reduced, onDemote: demote });
			ticker.renderOnce();
			requestAnimationFrame(() => {
				bridge.on();
				ticker.wake();
			});
			if (window.__GL) window.__GL = { layer, ticker, bridge, config, mgl };
		} catch {
			teardown();
		}
	});

	// panel de calibración bajo demanda (?gl=debug o #gl-debug)
	if (new URLSearchParams(location.search).get('gl') === 'debug' || location.hash === '#gl-debug') {
		window.__GL = { layer, ticker, bridge, config, mgl }; // acceso programático en calibración
		import('./debug.js').then((m) => m.mount({ layer, ticker, bridge, centerline })).catch(() => {});
	}
}
