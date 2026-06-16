// La capa de cards: quads, uniforms y las bandas de glitch dirigidas
// desde CPU (deterministas con seed → reproducibles en calibración).
import { config } from './config.js';
import { coverMapping, loadMediaTexture, loadVideoFrameTexture, rasterizeLabel, makeSolidTexture } from './textures.js';

// helper: color [r,g,b] 0..1 de preset.json → bytes [r,g,b,255] para textura
const rgb255 = (c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), 255];

function mulberry32(seed) {
	return function () {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createCardsLayer(mgl, bridge, videoFeed) {
	const { env } = bridge;
	const cards = []; // por card lógica
	let prog = null;
	let grainTex = null;
	let noiseTex = null;
	let grungeTex = null; // textura de mugre para el overlay del pase de lente
	let lens = null;     // pase de lente global (ojo de pez); null = directo a pantalla
	let target = null;   // FBO donde se compone la escena antes del warp
	let seed = 1234;
	let rng = mulberry32(seed);
	const overrides = { absDist: null, velocity: null, fx: 1, split: 0 };

	function setProgram(p) {
		prog = p;
	}

	function setStatic(grain, noise, grunge) {
		grainTex = grain;
		noiseTex = noise;
		grungeTex = grunge;
	}

	function reseed(s) {
		seed = s;
		rng = mulberry32(s);
		for (const c of cards) c.bands.length = 0;
	}

	function initCards() {
		cards.length = 0;
		let i = 0;
		let el;
		while ((el = bridge.instance(i))) {
			const isText = el.classList.contains('card--texto');
			const isClip = el.classList.contains('card--clip');
			cards.push({
				index: i,
				isText,
				isClip,
				hasMedia: !isText,
				mediaTex: null,
				labelTex: null,
				cover: { s: [1, 1], o: [0, 0] },
				bands: [],
				hide: false,
			});
			i++;
		}
		return cards.length;
	}

	async function buildTextures(labelScale) {
		await Promise.all(cards.map(async (c) => {
			const el = bridge.instance(c.index);
			// LITE: el texto va por DOM (nítido) — no se rasteriza ni sube
			c.labelTex = env.domText ? null : rasterizeLabel(mgl, el, labelScale);
			if (c.isText) {
				// fondo sólido como textura 1×1 → MISMO camino que las
				// imágenes (sin rama especial uBg). Color desde preset.bgColor.
				c.mediaTex = makeSolidTexture(mgl, rgb255(config.bgColor));
				c.hasMedia = true;
				c.cover = { s: [1, 1], o: [0, 0] }; // 1×1 sólido: cualquier UV = rojo
			} else if (c.isClip && env.domText) {
				// LITE: el clip se trata como imagen — su media es el PRIMER
				// frame del vídeo (textura estática; sin upload por frame).
				c.mediaTex = await loadVideoFrameTexture(mgl, el);
				if (!c.mediaTex) c.hasMedia = false;
				if (c.mediaTex) c.cover = coverMapping(c.mediaTex.w, c.mediaTex.h, env.cardW, env.cardH);
			} else if (c.hasMedia && !c.isClip) {
				c.mediaTex = await loadMediaTexture(mgl, el);
				if (!c.mediaTex) c.hasMedia = false;
				if (c.mediaTex) c.cover = coverMapping(c.mediaTex.w, c.mediaTex.h, env.cardW, env.cardH);
			}
		}));
	}

	function refreshCovers() {
		for (const c of cards) {
			if (c.mediaTex && !c.isText) c.cover = coverMapping(c.mediaTex.w, c.mediaTex.h, env.cardW, env.cardH);
		}
	}

	// re-raster de labels (resize, cambio de dPR/zoom). En LITE no hay
	// textura de label: se anulan (el texto va por DOM) y el shader deja
	// de samplearlas (uHasLabel = 0). Cubre el demote FULL→LITE en runtime.
	function rebuildLabels(scale) {
		if (env.domText) {
			for (const c of cards) c.labelTex = null;
			return;
		}
		for (const c of cards) {
			const el = bridge.instance(c.index);
			if (el) c.labelTex = rasterizeLabel(mgl, el, scale);
		}
	}

	// ¿texturas listas para el switch? (todas las visibles + 1 de margen)
	function readyFor(snapshot, visLimit) {
		return snapshot.cards.every((sc) => {
			const c = cards[sc.index];
			if (!c || sc.absDist > visLimit + 1) return true;
			const labelOK = env.domText || c.labelTex;
			// FULL: el clip llega por videoFeed (no espera mediaTex). LITE: el
			// clip es imagen (primer frame) → espera mediaTex como las demás.
			const clipByVideo = c.isClip && !env.domText;
			return labelOK && (!c.hasMedia || clipByVideo || c.mediaTex?.ready);
		});
	}

	function curveK(absDist) {
		const { start, end, power } = config.curve;
		const t = Math.min(Math.max((absDist - start) / (end - start), 0), 1);
		const s = t * t * (3 - 2 * t);
		return Math.pow(s, power);
	}

	// bandas de glitch: spawn estocástico (rng con seed), vida corta
	function updateBands(c, k, dt, now) {
		c.bands = c.bands.filter((b) => now - b.t0 < b.ttl);
		const rate = config.glitch.bandRate * k;
		if (c.bands.length < 6 && rng() < rate * dt) {
			c.bands.push({
				y: rng(),
				h: (0.2 + rng() * 0.8) * config.glitch.bandMaxH,
				off: (rng() * 2 - 1) * config.glitch.bandMaxOff,
				ttl: (0.4 + rng() * 0.6) * config.glitch.bandTtl * 1000,
				t0: now,
				strength: 0.4 + rng() * 0.6,
			});
		}
	}

	const bandData = new Float32Array(24);

	function render(snapshot, timing) {
		const { sx } = env;
		const reduced = !!timing.reduced; // prefers-reduced-motion: sin glitch/temblor/velocidad
		// lente global activa → las cards se componen a un FBO y luego un
		// pase de warp las dibuja curvadas a pantalla. amount 0 → ruta directa
		const splitW = overrides.split > 0 ? Math.round(env.bufferW / 2) : 0;
		// SIEMPRE por el FBO cuando hay lente: la ruta directa a pantalla
		// dejaba invisible la card de color sólido (sin media) en algunos
		// setups/GPU pese a dibujarse. El FBO+lente (passthrough exacto con
		// amount 0) es la ruta probada. En LITE la lente va a identidad.
		const useLens = !!(lens && target);
		if (useLens) {
			mgl.bindTarget(target);
			mgl.frame(env.bufferW, env.bufferH); // limpia el FBO; el split se aplica en el pase de lente
			mgl.setScissor(null);
		} else {
			mgl.bindScreen();
			mgl.frame(env.bufferW, env.bufferH);
			if (splitW) mgl.setScissor(0, 0, splitW, env.bufferH);
			else mgl.setScissor(null);
		}
		if (!prog) return;
		prog.use();

		// globales (una vez por frame)
		prog.u2f('uRes', env.bufferW, env.bufferH);
		prog.u1f('uFx', overrides.fx);
		prog.u3f('uTintColor', ...config.tint.color);
		prog.u1f('uTintAmount', config.tint.amount);
		prog.u1f('uTintDarken', config.tint.darken);
		prog.u1f('uTintGamma', config.tint.gamma);
		prog.u1f('uTintText', config.tint.textCard);
		prog.u1f('uSrgb', config.tint.srgb);
		prog.u3f('uBg', ...config.bgColor);
		prog.u3f('uHoleColor', ...config.glitch.holeColor);
		prog.u3f('uGradColor', ...config.gradient.color);
		prog.u1f('uGradExtent', config.gradient.extent);
		prog.u1f('uGlitchAmount', config.glitch.amount);
		prog.u1f('uRollAmp', reduced ? 0 : config.glitch.roll); // sin rolling bajo reduced
		prog.u1f('uRollPhase', timing.rollPhase);
		prog.u1f('uRollWave', config.glitch.rollWave);
		prog.u1f('uTremAmp', reduced ? 0 : config.tremor.amount); // sin temblor bajo reduced
		prog.u1f('uTremFreq', config.tremor.freq);
		prog.u1f('uTremPhase', timing.tremorPhase);
		prog.u1f('uTremAA', config.tremor.edgeAA);
		prog.u1f('uMargin', env.margin * sx);
		if (noiseTex) mgl.bind(noiseTex, 3); // tremor; el grano vive ahora en la lente
		prog.u1i('uNoise', 3);

		const trackW = env.rect.width;
		const visLimit = (trackW / env.slotW) / 2 + 1.2;
		const velBoost = overrides.velocity ?? timing.velBoost;

		// Graduación por PROXIMIDAD AL BORDE DEL VIEWPORT, no por nº de cards.
		// halfCap = slots del centro al borde EN ESTE monitor; reanclamos para
		// que el borde físico caiga siempre en la posición de curva `edgeRef`,
		// idéntico en laptop / Full HD / ultrawide. centerline sigue dando
		// slots físicos (posicionamiento, vídeo, culling intactos).
		const halfCap = (trackW / 2) / env.slotW;
		const edgeScale = halfCap > 0 ? config.curve.edgeRef / halfCap : 1;

		// gradiente de legibilidad (ángulo desde preset.gradient.angleDeg)
		const a = (config.gradient.angleDeg * Math.PI) / 180;
		const d = [Math.sin(a), -Math.cos(a)]; // uv y-abajo
		const L = Math.abs(env.cardW * d[0]) + Math.abs(env.cardH * d[1]);
		const gradDir = [d[0] * env.cardW, d[1] * env.cardH];

		for (const sc of snapshot.cards) {
			const c = cards[sc.index];
			if (!c) continue;
			if (Math.abs(sc.dist) > visLimit) continue;
			// override del panel = fuerza el input de curva directo (preview
			// del estado extremo); si no, distancia reanclada al viewport
			const gradeDist = overrides.absDist ?? (sc.absDist * edgeScale);

			let k = curveK(gradeDist) * (1 + velBoost);
			if (!reduced) updateBands(c, Math.min(k, 1), timing.dt, timing.now); // sin bandas bajo reduced

			// quad en px CSS del canvas (y luego a buffer con sx):
			// posición desde el centro fraccional medido de la instancia
			// y el scroll.left exacto del payload — cero cuantización
			let cx = trackW / 2 + sc.dist * env.slotW;
			const el = sc.el;
			if (el && env.centersFrac) {
				const instIdx = Number(el.dataset.copy) * cards.length + sc.index;
				const c = env.centersFrac[instIdx];
				if (c !== undefined) cx = c - snapshot.scroll.left;
			}
			const x = cx - env.cardW / 2 - env.margin;
			const y = 0; // canvas ya inflado: la card empieza en margin
			const w = env.cardW + env.margin * 2;
			const h = env.cardH + env.margin * 2;
			prog.u4f('uRect', x * sx, y * sx, w * sx, h * sx);
			prog.u2f('uQuad', w * sx, h * sx);
			prog.u1f('uK', k);
			prog.u1f('uHide', c.hide ? 1 : 0);
			prog.u1f('uIsText', c.isText ? 1 : 0);
			prog.u1f('uGradOn', c.isText ? 0 : 1); // la card de texto nunca lleva gradiente
			prog.u2f('uGradOrigin', 0, 1);
			prog.u3f('uGradDir', gradDir[0], gradDir[1], 1 / L);

			// media: imagen estática o vídeo de la instancia activa.
			// El vídeo solo se sube a GL en FULL; en LITE (env.domText) va por
			// DOM plano (sin texImage2D por frame → sin tirones en móvil); el
			// canvas deja la card clip con uHasMedia 0 y el <video> DOM la cubre.
			let media = c.mediaTex;
			if (c.isClip && !env.domText) {
				const video = sc.el?.querySelector('video');
				if (video) {
					media = videoFeed.texFor(c.index, video);
					if (media && media.w > 1) {
						c.cover = coverMapping(media.w, media.h, env.cardW, env.cardH);
					}
				}
			}
			// clip sin frame aún (vídeo cargando): uHasMedia 0 → fondo limpio,
			// no se pinta basura de otra card hasta el 1er frame del vídeo.
			const hasMedia = c.hasMedia && !!media;
			if (hasMedia) mgl.bind(media, 0);
			prog.u1i('uMedia', 0);
			prog.u1f('uHasMedia', hasMedia ? 1 : 0);
			if (c.labelTex) mgl.bind(c.labelTex, 1);
			prog.u1i('uLabel', 1);
			prog.u1f('uHasLabel', c.labelTex ? 1 : 0); // LITE: 0 (texto por DOM)
			prog.u2f('uCoverS', c.cover.s[0], c.cover.s[1]);
			prog.u2f('uCoverO', c.cover.o[0], c.cover.o[1]);

			// bandas → uniform array (ninguna bajo reduced-motion)
			let n = 0;
			if (!reduced) for (const b of c.bands) {
				if (n >= 6) break;
				bandData[n * 4] = b.y;
				bandData[n * 4 + 1] = b.h;
				bandData[n * 4 + 2] = b.off;
				bandData[n * 4 + 3] = b.strength;
				n++;
			}
			prog.u4fv('uBands', bandData);
			prog.u1i('uBandCount', n);

			mgl.drawQuad();
		}
		mgl.setScissor(null);

		// pase de lente global: la escena del FBO → pantalla, + grano
		// screen-space (tras el warp, sin estiramiento). El fisheye se aplica
		// en TODOS los perfiles (incl. LITE/móvil): el FBO+pase ya corren, el
		// warp es coste despreciable. LITE usa su propio bloque fisheyeLite
		// (curva más suave: el texto va por DOM plano sobre la card curvada).
		// Fallback a config.fisheye para presets viejos sin el bloque.
		if (useLens) {
			const fish = env.domText ? (config.fisheyeLite ?? config.fisheye) : config.fisheye;
			lens.draw(target, fish, splitW, {
				grainTex,
				grain: config.grain,
				curve: config.curve,
				grainSeed: timing.grainSeed,
				velBoost,
				grungeTex,
				grunge: config.grunge,
				grungeState: timing.grunge,
			});
		}
	}

	return {
		cards,
		overrides,
		setLens(l, t) { lens = l; target = t; },
		initCards,
		buildTextures,
		refreshCovers,
		rebuildLabels,
		readyFor,
		render,
		setProgram,
		setStatic,
		reseed,
		curveK,
		setHide(index, hide) {
			for (const c of cards) c.hide = false;
			if (index >= 0 && cards[index]) cards[index].hide = hide;
		},
	};
}
