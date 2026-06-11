// Drag con ratón (solo pointerType mouse: el touch usa scroll nativo).
// Umbral de 5px preserva el click en cards; ring buffer de posiciones
// para la velocidad de lanzamiento; supresión del click post-drag.

const THRESHOLD = 5;

export function createDrag(trackEl, animator, snap) {
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
			snap.acquire('drag');
			trackEl.classList.add('is-dragging');
			trackEl.setPointerCapture(pointerId);
		}
		trackEl.scrollLeft = startScroll - dx;
		const now = performance.now();
		samples.push({ t: now, x: e.clientX });
		while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
	}

	function onUp(e) {
		if (e.pointerId !== pointerId) return;
		pointerId = -1;
		trackEl.removeEventListener('pointermove', onMove);
		trackEl.removeEventListener('pointerup', onUp);
		trackEl.removeEventListener('pointercancel', onUp);
		if (!dragging) return;
		dragging = false;
		trackEl.classList.remove('is-dragging');

		// suprimir el click que sigue a un drag real
		trackEl.addEventListener('click', (ce) => {
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
		animator.momentum(v); // adquiere snap; release del drag tras el handoff
		snap.release('drag');
	}

	trackEl.addEventListener('pointerdown', (e) => {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		animator.cancel();
		pointerId = e.pointerId;
		startX = e.clientX;
		startScroll = trackEl.scrollLeft;
		samples = [{ t: performance.now(), x: e.clientX }];
		trackEl.addEventListener('pointermove', onMove);
		trackEl.addEventListener('pointerup', onUp);
		trackEl.addEventListener('pointercancel', onUp);
	});
}
