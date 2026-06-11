// Consumidor: expone la señal como CSS custom properties.
// --dist por instancia y --vel en el track: efectos CSS gratis en Fase 1.
// Es un SUMIDERO, no la señal canónica — la capa GL de Fase 2 leerá de
// centerline.subscribe/getSnapshot, jamás de getComputedStyle.

export function createCssBridge(trackEl, geometry, centerline) {
	if (window.CSS?.registerProperty) {
		try {
			CSS.registerProperty({ name: '--dist', syntax: '<number>', inherits: false, initialValue: '0' });
			CSS.registerProperty({ name: '--vel', syntax: '<number>', inherits: false, initialValue: '0' });
		} catch { /* ya registradas (HMR/doble init) */ }
	}

	let els = [];
	const refresh = () => { els = [...trackEl.querySelectorAll('.card')]; };
	geometry.onInvalidate(refresh);
	refresh();

	let disabled = false;

	centerline.subscribe((s) => {
		if (disabled) return;
		const g = geometry.get();
		const vc = s.scroll.left + g.containerW / 2;
		for (let k = 0; k < els.length; k++) {
			els[k].style.setProperty('--dist', ((g.centers[k] - vc) / g.slotW).toFixed(3));
		}
		trackEl.style.setProperty('--vel', (s.velocity.smooth / 1000).toFixed(3));
	}, { order: 30 });

	return {
		disable() { disabled = true; }, // la Fase 2 puede reemplazar los efectos CSS
	};
}
