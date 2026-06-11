// PRODUCTOR central: la señal "distancia de cada card al centro".
// ESTE PAYLOAD ES EL CONTRATO DE LA FASE 2 (capa WebGL) — no cambiar
// su forma sin actualizar el plan. Objeto preasignado, mutado in place.
//
// {
//   t,                                  // timestamp del rAF
//   scroll: { left, phase },            // phase: 0..1 circular (loop)
//   unwrapped,                          // acumulador monotónico de scroll (px),
//                                       //   inmune a los teleports del loop
//   velocity: { px, smooth },           // px/s; smooth = EMA alfa 0.25
//   centeredIndex, settled,
//   cards: [{ index, el, dist, absDist }] // 10 entradas lógicas;
//                                       //   dist = (centroInstanciaMasCercana
//                                       //   - centroViewport) / slotW, en
//                                       //   unidades de slot: vecina = ±1
// }
//
// Ciclo de vida: scroll marca dirty -> rAF activo mientras dirty o
// retainCount > 0 -> en quiescencia emite settled:true y se duerme.
import { onScrollSettled } from './settle.js';

export function createCenterline(trackEl, geometry) {
	const g = geometry.get();
	const N = g.logicalCount;

	const payload = {
		t: 0,
		scroll: { left: 0, phase: 0 },
		unwrapped: 0,
		velocity: { px: 0, smooth: 0 },
		centeredIndex: 0,
		settled: true,
		cards: Array.from({ length: N }, (_, i) => ({ index: i, el: null, dist: 0, absDist: 0 })),
	};

	const subscribers = [];
	const settledFns = [];
	let dirty = true;
	let retainCount = 0;
	let rafId = 0;
	let running = false;
	let lastScroll = trackEl.scrollLeft;
	let lastT = 0;
	let pendingJump = 0;
	let cardEls = [];

	function cacheEls() {
		cardEls = [...trackEl.querySelectorAll('.card')];
	}

	function compute(t) {
		const sl = trackEl.scrollLeft;
		const dt = lastT ? Math.min(t - lastT, 100) : 16.7; // clamp: background/jank no envenena la velocidad
		lastT = t;

		const moved = sl - lastScroll - pendingJump;
		pendingJump = 0;
		lastScroll = sl;
		payload.unwrapped += moved;

		const vPx = (moved / dt) * 1000;
		payload.velocity.px = vPx;
		payload.velocity.smooth += (vPx - payload.velocity.smooth) * 0.25;

		const vc = sl + g.containerW / 2;
		payload.t = t;
		payload.scroll.left = sl;
		payload.scroll.phase = g.period > 0 ? (((vc - g.centers[0]) / g.period) % 1 + 1) % 1 : 0;

		let best = 0;
		let bestAbs = Infinity;
		for (let i = 0; i < N; i++) {
			const base = g.centers[i];
			let k = Math.round((vc - base) / g.period);
			k = Math.max(0, Math.min(g.copies - 1, k));
			const instIdx = k * N + i;
			const dist = (g.centers[instIdx] - vc) / g.slotW;
			const card = payload.cards[i];
			card.el = cardEls[instIdx];
			card.dist = dist;
			card.absDist = Math.abs(dist);
			if (card.absDist < bestAbs) {
				bestAbs = card.absDist;
				best = i;
			}
		}
		payload.centeredIndex = best;
	}

	function emit() {
		for (const s of subscribers) s.fn(payload);
	}

	function frame(t) {
		rafId = 0;
		if (!dirty && retainCount === 0) {
			running = false;
			return;
		}
		dirty = false;
		compute(t);
		emit();
		rafId = requestAnimationFrame(frame);
	}

	function wake() {
		dirty = true;
		payload.settled = false;
		if (!running) {
			running = true;
			rafId = requestAnimationFrame(frame);
		}
	}

	trackEl.addEventListener('scroll', wake, { passive: true });

	onScrollSettled(trackEl, () => {
		// frame final con settled:true antes de dormir
		payload.settled = true;
		compute(performance.now());
		emit();
		for (const fn of settledFns) fn(payload);
	});

	geometry.onInvalidate(() => {
		cacheEls();
		wake();
	});
	cacheEls();

	return {
		subscribe(fn, { order = 0 } = {}) {
			const s = { fn, order };
			subscribers.push(s);
			subscribers.sort((a, b) => a.order - b.order);
			return () => {
				const i = subscribers.indexOf(s);
				if (i >= 0) subscribers.splice(i, 1);
			};
		},
		getSnapshot: () => payload,
		onSettled(fn) {
			settledFns.push(fn);
		},
		// el loop avisa de sus teleports para que unwrapped/velocity no los vean
		notifyJump(delta) {
			pendingJump += delta;
		},
		retain() {
			retainCount++;
			if (!running) wake();
		},
		release() {
			retainCount = Math.max(0, retainCount - 1);
		},
		wake,
	};
}
