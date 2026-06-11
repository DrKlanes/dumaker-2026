// Árbitro único del scroll-snap nativo del track.
// Mientras alguien posee el lock (refcount > 0), el snap CSS está
// desactivado (.is-controlled). Nadie toca la clase fuera de aquí.
// Regla dura: un gesto táctil nativo recupera el snap inmediatamente.

export function createSnap(trackEl) {
	const owners = new Set();

	function apply() {
		trackEl.classList.toggle('is-controlled', owners.size > 0);
	}

	return {
		acquire(owner) {
			owners.add(owner);
			apply();
		},
		release(owner) {
			owners.delete(owner);
			apply();
		},
		forceReleaseAll() {
			owners.clear();
			apply();
		},
		isControlled: () => owners.size > 0,
	};
}
