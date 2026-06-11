// Navegación por teclado del carrusel: flechas, Home/End.
// El foco dentro de una card (Tab) también centra esa card, cancelando
// el auto-scroll brusco del navegador a mitad de camino.

export function createKeyboard(trackEl, centerline, animator, logicalCount) {
	trackEl.addEventListener('keydown', (e) => {
		const i = centerline.getSnapshot().centeredIndex;
		let target = null;
		if (e.key === 'ArrowRight') target = (i + 1) % logicalCount;
		else if (e.key === 'ArrowLeft') target = (i - 1 + logicalCount) % logicalCount;
		else if (e.key === 'Home') target = 0;
		else if (e.key === 'End') target = logicalCount - 1;
		if (target === null) return;
		e.preventDefault();
		animator.goToLogical(target);
	});

	trackEl.addEventListener('focusin', (e) => {
		const card = e.target.closest?.('.card');
		if (!card) return;
		const i = Number(card.dataset.index);
		if (!Number.isInteger(i)) return;
		if (i !== centerline.getSnapshot().centeredIndex) {
			animator.cancel();
			animator.goToLogical(i);
		}
	});
}
