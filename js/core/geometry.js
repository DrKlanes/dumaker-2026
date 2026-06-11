// Caché de medidas del track. Se mide en invalidación (resize, fuentes),
// nunca en el frame loop: el loop de centerline es aritmética pura.

export function createGeometry(trackEl, { copies, logicalCount }) {
	const state = {
		containerW: 0,
		slotW: 0,
		cardW: 0,
		period: 0,
		copies,
		logicalCount,
		centers: [], // centro absoluto (coords de scroll) de cada instancia
		total: 0,
	};
	const invalidateFns = [];

	function measure() {
		const cards = trackEl.querySelectorAll('.card');
		state.total = cards.length;
		state.containerW = trackEl.clientWidth;
		state.centers = [];
		for (const el of cards) {
			state.centers.push(el.offsetLeft + el.offsetWidth / 2);
		}
		if (state.total >= 2) {
			state.cardW = cards[0].offsetWidth;
			state.slotW = state.centers[1] - state.centers[0];
			state.period = state.slotW * logicalCount;
		}
		for (const fn of invalidateFns) fn(state);
	}

	// scrollLeft exacto que centra la instancia k
	function centerOffset(k) {
		return state.centers[k] - state.containerW / 2;
	}

	const ro = new ResizeObserver(() => measure());
	ro.observe(trackEl);
	document.fonts?.ready.then(measure);
	measure();

	return {
		get: () => state,
		centerOffset,
		remeasure: measure,
		onInvalidate(fn) {
			invalidateFns.push(fn);
		},
	};
}
