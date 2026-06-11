// Disciplina del loop infinito: recentrado a la copia central.
// El teleport es píxel-idéntico (contenido periódico) pero NUNCA se hace
// durante momentum nativo: solo en reposo (settled) o al arrancar un
// gesto táctil nuevo (touchstart, antes de que haya inercia que matar).

export function createLoop(trackEl, geometry, centerline) {
	const teleportFns = [];

	function recenter() {
		const g = geometry.get();
		if (!g.period) return false;
		const vc = trackEl.scrollLeft + g.containerW / 2;
		const instIdx = Math.round((vc - g.centers[0]) / g.slotW);
		const copyOfCentered = Math.floor(instIdx / g.logicalCount);
		const central = Math.floor(g.copies / 2);
		const shift = copyOfCentered - central;
		if (shift === 0) return false;
		const delta = -shift * g.period;
		centerline.notifyJump(delta);
		trackEl.scrollLeft += delta;
		for (const fn of teleportFns) fn(delta);
		return true;
	}

	centerline.onSettled(() => recenter());
	trackEl.addEventListener('touchstart', () => recenter(), { passive: true });

	return {
		recenter,
		// la fase 2 / el consumidor de vídeo pueden reaccionar al teleport
		// (p. ej. transferir currentTime entre instancias en el mismo frame)
		onTeleport(fn) {
			teleportFns.push(fn);
		},
	};
}
