// Rueda/trackpad sobre la zona de cards.
// Trackpad horizontal (deltaX dominante): no intervenimos, scroll nativo.
// Rueda vertical: se traduce a horizontal con escrituras propias por frame
// (NUNCA scrollBy con snap mandatory activo: efecto trinquete). Al quedar
// idle, momentum + snap por JS.

export function createWheel(zoneEl, trackEl, animator, snap) {
	let idleTimer = 0;
	let lastT = 0;
	let velocity = 0;

	function onIdle() {
		idleTimer = 0;
		animator.momentum(velocity);
		velocity = 0;
		snap.release('wheel');
	}

	zoneEl.addEventListener('wheel', (e) => {
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal nativo
		// rueda vertical sobre una caja de texto prose con scroll disponible:
		// que scrollee el texto, no el carrusel (overscroll-behavior:contain
		// corta el chaining en el borde). Sin esto el listener se la comería:
		// preventDefault + scroll horizontal aunque haya overflow vertical.
		const sub = e.target.closest?.('.card--prose .card__sub');
		if (sub && sub.scrollHeight > sub.clientHeight + 1) return;
		e.preventDefault();
		animator.cancel();

		let d = e.deltaY;
		if (e.deltaMode === 1) d *= 16;       // Firefox: modo línea
		else if (e.deltaMode === 2) d *= trackEl.clientWidth;
		d = Math.max(-120, Math.min(120, d)); // cap por evento

		snap.acquire('wheel');
		trackEl.scrollLeft += d;

		const now = performance.now();
		const dt = Math.min(now - (lastT || now - 16), 100) || 16;
		lastT = now;
		// estimación de velocidad con suavizado para el momentum de salida
		velocity = velocity * 0.7 + (d / dt) * 1000 * 0.3;

		clearTimeout(idleTimer);
		idleTimer = setTimeout(onIdle, 120);
	}, { passive: false });

	return {
		cancelIdle() {
			clearTimeout(idleTimer);
			idleTimer = 0;
			velocity = 0;
			snap.release('wheel');
		},
	};
}

// Traducción rueda→horizontal sin snap ni momentum (para el menú).
// Solo interviene si la fila desborda; si cabe entera, no toca nada.
export function createSimpleWheel(el) {
	el.addEventListener('wheel', (e) => {
		if (el.scrollWidth <= el.clientWidth) return;
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		e.preventDefault();
		let d = e.deltaY;
		if (e.deltaMode === 1) d *= 16;
		else if (e.deltaMode === 2) d *= el.clientWidth;
		el.scrollLeft += d;
	}, { passive: false });
}
