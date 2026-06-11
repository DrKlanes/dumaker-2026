// Único escritor de animaciones sobre scrollLeft. Single-flight.
// goTo del menú: easing cubic-out, duración proporcional con techo.
// momentum (wheel/drag): destino proyectado + velocidad inicial igualada.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const cubicOut = (t) => 1 - (1 - t) ** 3;

export function createAnimator(trackEl, geometry, centerline, snap) {
	let rafId = 0;
	let resolveCurrent = null;

	function stop(result) {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		if (resolveCurrent) {
			resolveCurrent(result);
			resolveCurrent = null;
		}
	}

	function animate(target, duration) {
		stop('cancelled');
		const from = trackEl.scrollLeft;
		const delta = target - from;
		if (Math.abs(delta) < 1) {
			trackEl.scrollLeft = target;
			return Promise.resolve('done');
		}
		if (REDUCED.matches || duration <= 0) {
			snap.acquire('animator');
			trackEl.scrollLeft = target;
			requestAnimationFrame(() => snap.release('animator'));
			return Promise.resolve('done');
		}
		snap.acquire('animator');
		const t0 = performance.now();
		return new Promise((resolve) => {
			resolveCurrent = resolve;
			function tick(now) {
				const p = Math.min((now - t0) / duration, 1);
				trackEl.scrollLeft = from + delta * cubicOut(p);
				if (p < 1) {
					rafId = requestAnimationFrame(tick);
				} else {
					trackEl.scrollLeft = target; // aterrizaje exacto en el snap point
					rafId = 0;
					// restaurar snap en el frame SIGUIENTE al último write:
					// el re-snap obligatorio de Safari queda en no-op
					requestAnimationFrame(() => snap.release('animator'));
					const r = resolveCurrent;
					resolveCurrent = null;
					r('done');
				}
			}
			rafId = requestAnimationFrame(tick);
		});
	}

	// instancia más cercana de la card lógica i (camino más corto modular)
	function nearestTarget(logicalIndex) {
		const g = geometry.get();
		const vc = trackEl.scrollLeft + g.containerW / 2;
		const base = g.centers[logicalIndex];
		let k = Math.round((vc - base) / g.period);
		k = Math.max(0, Math.min(g.copies - 1, k));
		return geometry.centerOffset(k * g.logicalCount + logicalIndex);
	}

	return {
		goToLogical(i) {
			const target = nearestTarget(i);
			const d = Math.abs(target - trackEl.scrollLeft);
			const duration = Math.max(450, Math.min(140 * Math.sqrt(d), 1100));
			return animate(target, duration);
		},
		jumpToLogical(i) {
			return animate(nearestTarget(i), 0);
		},
		// lanzamiento con inercia: proyecta destino con decay (~0.35s de
		// integral), snapea al slot más cercano del destino y ajusta la
		// duración para igualar la velocidad inicial (cubic-out: v0 = 3*d/T)
		momentum(velocityPx) {
			const g = geometry.get();
			const projected = trackEl.scrollLeft + velocityPx * 0.35;
			const first = geometry.centerOffset(0);
			let idx = Math.round((projected - first) / g.slotW);
			idx = Math.max(0, Math.min(g.total - 1, idx));
			const target = geometry.centerOffset(idx);
			const d = Math.abs(target - trackEl.scrollLeft);
			const v = Math.abs(velocityPx);
			const duration = v > 50
				? Math.max(300, Math.min((3 * d / v) * 1000, 1200))
				: 450;
			return animate(target, duration);
		},
		cancel() {
			if (rafId) {
				stop('cancelled');
				snap.release('animator');
			}
		},
		isAnimating: () => rafId !== 0,
	};
}
