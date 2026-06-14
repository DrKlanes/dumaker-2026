// Orquestador único: carga datos → render → módulos del carrusel.
// Regla de dependencias: core no importa nada externo; input usa
// animator+snap; consumers solo consumen centerline. Nadie importa main.
// Fase 2: la capa GL se importa ESTÁTICA (init se llama tras el settled).
// Antes era import() dinámico, pero los módulos dinámicos caen fuera de
// la ventana de hard-reload → GitHub Pages servía JS cacheado 10 min.
import { loadData } from './data/cards.js';
import { renderMenu, renderTrack, renderDataError } from './dom/render.js';
import { createGeometry } from './core/geometry.js';
import { createCenterline } from './core/centerline.js';
import { createAnimator } from './core/animator.js';
import { createSnap } from './core/snap.js';
import { createLoop } from './core/loop.js';
import { createWheel, createSimpleWheel } from './input/wheel.js';
import { createDrag, createGlide } from './input/drag.js';
import { createKeyboard } from './input/keyboard.js';
import { createMenuSync } from './consumers/menu.js';
import { createVideoSync } from './consumers/video.js';
import { createCssBridge } from './consumers/cssBridge.js';
import { init as initGL } from './consumers/gl/index.js';

const COPIES = 5; // loop infinito: copia central canónica, ±2 periodos de pista

async function boot() {
	history.scrollRestoration = 'manual';

	const { cards, ahoraTexto, fatal } = await loadData();
	if (fatal) {
		renderDataError(fatal);
		return;
	}

	const menuEl = document.querySelector('.menu');
	const trackEl = document.querySelector('.track');
	const zoneEl = document.querySelector('.strip--cards');
	renderMenu(cards, menuEl);
	renderTrack(cards, ahoraTexto, trackEl, COPIES);

	const N = cards.length;
	const geometry = createGeometry(trackEl, { copies: COPIES, logicalCount: N });
	const centerline = createCenterline(trackEl, geometry);
	const snap = createSnap(trackEl);
	const animator = createAnimator(trackEl, geometry, centerline, snap);
	const loop = createLoop(trackEl, geometry, centerline);

	const wheel = createWheel(zoneEl, trackEl, animator, snap);
	createDrag(trackEl, {
		onGrab: () => animator.cancel(),
		onDragStart: () => snap.acquire('drag'),
		onRelease: (v) => {
			animator.momentum(v);
			snap.release('drag');
		},
	});
	createKeyboard(trackEl, centerline, animator, N);

	// el menú desbordado se navega igual que el carrusel: rueda y arrastre
	const menuGlide = createGlide(menuEl);
	createSimpleWheel(menuEl);
	createDrag(menuEl, {
		onGrab: () => menuGlide.cancel(),
		onRelease: (v) => menuGlide.start(v),
	});

	createMenuSync(menuEl, cards, centerline, animator);
	createVideoSync(trackEl, geometry, centerline, loop);
	const cssBridge = createCssBridge(trackEl, geometry, centerline);

	// Fase 2: capa cinética GL — init tras el primer reposo (el módulo ya
	// está cargado por el import estático); si falla su boot, Fase 1 intacta
	Promise.race([
		new Promise((r) => centerline.onSettled(r)),
		new Promise((r) => setTimeout(r, 4000)),
	]).then(() => initGL({ centerline, loop, cssBridge }))
		.catch(() => {});

	// un gesto táctil nativo recupera el snap CSS inmediatamente
	trackEl.addEventListener('touchstart', () => {
		animator.cancel();
		wheel.cancelIdle();
		snap.forceReleaseAll();
	}, { passive: true });

	// resize: re-centrar instantáneo la card que estaba centrada
	let resizeTimer = 0;
	geometry.onInvalidate(() => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			if (!animator.isAnimating()) {
				animator.jumpToLogical(centerline.getSnapshot().centeredIndex);
			}
		}, 100);
	});

	// posición inicial: hash > sessionStorage > 0 — instantánea, sin viaje
	const byId = (id) => cards.findIndex((c) => c.id === id);
	const fromHash = byId(location.hash.slice(1));
	const fromSession = Number(sessionStorage.getItem('dumaker.centered'));
	const initial = fromHash >= 0 ? fromHash
		: (Number.isInteger(fromSession) && fromSession >= 0 && fromSession < N) ? fromSession
		: 0;
	animator.jumpToLogical(initial);
	// el salto inicial puede aterrizar en cualquier copia (p. ej. scroll 0
	// = card 00 de la copia 0); el recentrado no puede esperar al settle
	// porque sin movimiento no hay eventos de scroll
	loop.recenter();

	// al asentarse: persistir card centrada y reflejarla en la URL
	// (replaceState: sin entradas de historial ni scroll de anclaje)
	centerline.onSettled((s) => {
		sessionStorage.setItem('dumaker.centered', s.centeredIndex);
		const id = cards[s.centeredIndex]?.id;
		if (id && location.hash !== `#${id}`) {
			history.replaceState(null, '', `#${id}`);
		}
	});

	// el logo del hero vuelve al inicio (card 00) con el mismo viaje del menú;
	// con la 00 ya centrada el goTo se auto-anula (destino a <1px) — sin
	// recarga, sin perder estado
	document.querySelector('.hero__home').addEventListener('click', (e) => {
		e.preventDefault();
		animator.goToLogical(0);
	});

	// navegación in-page por hash (enlaces externos al menú, atrás/adelante)
	addEventListener('hashchange', () => {
		const i = byId(location.hash.slice(1));
		if (i >= 0 && i !== centerline.getSnapshot().centeredIndex) {
			animator.goToLogical(i);
		}
	});

	// bfcache: re-medir y re-asentar
	addEventListener('pageshow', (e) => {
		if (e.persisted) {
			geometry.remeasure();
			animator.jumpToLogical(centerline.getSnapshot().centeredIndex);
		}
	});

	centerline.wake(); // primer frame: estado activo del menú + CSS vars
}

boot();
