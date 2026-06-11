// Drag con ratón (solo pointerType mouse: el touch usa scroll nativo).
// Generalizado: el carrusel y el menú comparten esta lógica; cada uno
// aporta sus hooks (snap+momentum en el carrusel, glide simple en el menú).
// Umbral de 5px preserva el click; ring buffer de posiciones para la
// velocidad de lanzamiento; supresión del click post-drag.

const THRESHOLD = 5;

export function createDrag(el, { onGrab = () => {}, onDragStart = () => {}, onRelease = () => {} } = {}) {
	let startX = 0;
	let startScroll = 0;
	let dragging = false;
	let pointerId = -1;
	let samples = []; // [{t, x}] últimos ~100ms

	function onMove(e) {
		if (e.pointerId !== pointerId) return;
		const dx = e.clientX - startX;
		if (!dragging) {
			if (Math.abs(dx) < THRESHOLD) return;
			dragging = true;
			el.classList.add('is-dragging');
			try { el.setPointerCapture(pointerId); } catch { /* puntero ya inactivo */ }
			onDragStart();
		}
		el.scrollLeft = startScroll - dx;
		const now = performance.now();
		samples.push({ t: now, x: e.clientX });
		while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
	}

	function onUp(e) {
		if (e.pointerId !== pointerId) return;
		pointerId = -1;
		el.removeEventListener('pointermove', onMove);
		el.removeEventListener('pointerup', onUp);
		el.removeEventListener('pointercancel', onUp);
		if (!dragging) return;
		dragging = false;
		el.classList.remove('is-dragging');

		// suprimir el click que sigue a un drag real
		el.addEventListener('click', (ce) => {
			ce.preventDefault();
			ce.stopPropagation();
		}, { capture: true, once: true });

		let v = 0;
		if (samples.length >= 2) {
			const a = samples[0];
			const b = samples[samples.length - 1];
			const dt = b.t - a.t;
			if (dt > 0) v = -((b.x - a.x) / dt) * 1000; // scroll opuesto al puntero
		}
		samples = [];
		onRelease(v);
	}

	el.addEventListener('pointerdown', (e) => {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		onGrab();
		pointerId = e.pointerId;
		startX = e.clientX;
		startScroll = el.scrollLeft;
		samples = [{ t: performance.now(), x: e.clientX }];
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
	});
}

// Inercia simple sin snap (para el menú): decay exponencial hasta parar.
export function createGlide(el) {
	let rafId = 0;
	return {
		start(velocityPx) {
			cancelAnimationFrame(rafId);
			let v = velocityPx;
			let last = performance.now();
			const tick = (now) => {
				const dt = Math.min(now - last, 64) / 1000;
				last = now;
				el.scrollLeft += v * dt;
				v *= Math.exp(-dt * 4);
				if (Math.abs(v) > 20) rafId = requestAnimationFrame(tick);
				else rafId = 0;
			};
			rafId = requestAnimationFrame(tick);
		},
		cancel() {
			cancelAnimationFrame(rafId);
			rafId = 0;
		},
	};
}
