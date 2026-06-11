// Consumidor: sincronización del menú con la card centrada.
// Unidireccional: el estado activo SIEMPRE viene de centeredIndex del
// productor — el click solo pide goTo, nunca marca activo por su cuenta.

export function createMenuSync(menuEl, cards, centerline, animator) {
	const items = [...menuEl.querySelectorAll('.menu__item')];
	let active = -1;

	function setActive(i) {
		if (i === active) return;
		if (items[active]) {
			items[active].classList.remove('is-active');
			items[active].removeAttribute('aria-current');
		}
		active = i;
		const item = items[i];
		if (!item) return;
		item.classList.add('is-active');
		item.setAttribute('aria-current', 'true');
		// en fila desbordada (móvil / desktop estrecho), el activo se auto-centra
		if (menuEl.scrollWidth > menuEl.clientWidth) {
			menuEl.scrollTo({
				left: item.offsetLeft - menuEl.clientWidth / 2 + item.offsetWidth / 2,
				behavior: 'auto',
			});
		}
	}

	centerline.subscribe((s) => setActive(s.centeredIndex), { order: 10 });

	menuEl.addEventListener('click', (e) => {
		const a = e.target.closest('.menu__item');
		if (!a) return;
		e.preventDefault(); // el hash lo gestiona main vía replaceState al asentarse
		const i = Number(a.dataset.index);
		animator.goToLogical(i);
	});

	setActive(centerline.getSnapshot().centeredIndex);
}
