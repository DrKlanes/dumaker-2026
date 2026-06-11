// Consumidor: cards-clip. Solo la instancia cercana al centro reproduce.
// Histéresis play<0.6 / pause>0.8 (sin parpadeo en el borde); src lazy
// por distancia; liberación de decodificadores lejos del viewport (iOS).
// En teleport del loop: transferencia de currentTime entre instancias.

const PLAY_AT = 0.6;
const PAUSE_AT = 0.8;
const LOAD_AT = 1.5;
const UNLOAD_AT = 2.5;

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

export function createVideoSync(trackEl, geometry, centerline, loop) {
	const videos = [...trackEl.querySelectorAll('video[data-src]')];
	if (videos.length === 0) return; // sin clips en los datos actuales

	function distOf(video, snapshot) {
		const card = video.closest('.card');
		const i = Number(card.dataset.index);
		const copy = Number(card.dataset.copy);
		const g = geometry.get();
		const instIdx = copy * g.logicalCount + i;
		const vc = snapshot.scroll.left + g.containerW / 2;
		return Math.abs((g.centers[instIdx] - vc) / g.slotW);
	}

	centerline.subscribe((s) => {
		for (const v of videos) {
			const d = distOf(v, s);
			if (d < LOAD_AT && !v.src) {
				v.src = v.dataset.src;
			} else if (d > UNLOAD_AT && v.src) {
				v.removeAttribute('src');
				v.load();
				continue;
			}
			if (!v.src) continue;
			if (d < PLAY_AT && v.paused && !REDUCED.matches) {
				v.play().catch(() => {});
			} else if (d > PAUSE_AT && !v.paused) {
				v.pause();
			}
		}
	}, { order: 20 });

	// teleport con un clip centrado: la instancia activa cambia de copia;
	// transferir el punto de reproducción en el mismo frame (costura invisible)
	loop.onTeleport(() => {
		const playing = videos.find((v) => !v.paused && v.src);
		if (!playing) return;
		const s = centerline.getSnapshot();
		for (const v of videos) {
			if (v === playing) continue;
			if (v.dataset.src === playing.dataset.src && distOf(v, s) < PLAY_AT) {
				if (!v.src) v.src = v.dataset.src;
				v.currentTime = playing.currentTime;
				playing.pause();
				v.play().catch(() => {});
				break;
			}
		}
	});

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) for (const v of videos) v.pause();
	});
}
