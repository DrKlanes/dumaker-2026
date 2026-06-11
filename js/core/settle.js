// Detección de quiescencia del scroll.
// scrollend no existe en iOS <= 18, y donde existe tiene huecos (no dispara
// si la posición no cambió). Mecanismo primario: debounce + verificación de
// estabilidad de posición; scrollend actúa solo como acelerador.

const IOS = /iP(hone|od|ad)/.test(navigator.platform) ||
	(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const DEBOUNCE_MS = IOS ? 150 : 100;
const STABLE_MS = 80;

export function onScrollSettled(el, cb) {
	let timer = 0;
	let stableCheck = 0;

	function confirmStable() {
		const before = el.scrollLeft;
		stableCheck = setTimeout(() => {
			if (el.scrollLeft === before) cb();
			else schedule(); // seguía moviéndose (momentum lento): reintentar
		}, STABLE_MS);
	}

	function schedule() {
		clearTimeout(timer);
		clearTimeout(stableCheck);
		timer = setTimeout(confirmStable, DEBOUNCE_MS);
	}

	function onScrollEnd() {
		clearTimeout(timer);
		clearTimeout(stableCheck);
		confirmStable();
	}

	el.addEventListener('scroll', schedule, { passive: true });
	if ('onscrollend' in el) el.addEventListener('scrollend', onScrollEnd);

	return () => {
		clearTimeout(timer);
		clearTimeout(stableCheck);
		el.removeEventListener('scroll', schedule);
		if ('onscrollend' in el) el.removeEventListener('scrollend', onScrollEnd);
	};
}
