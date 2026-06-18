// Puente con el DOM de Fase 1 — todo en runtime, cero diffs en CSS/HTML.
// La supresión del pintado es UNA clase (.gl-on): restauración atómica.
// El foco por teclado revela la card DOM real (el canvas taparía el
// anillo de :focus-visible — regresión WCAG si no).

const STYLE = `
.strip--cards.gl-on .card__media,
.strip--cards.gl-on .card__title,
.strip--cards.gl-on .card__sub { opacity: 0; }
.strip--cards.gl-on .card--texto { background: transparent; }
.strip--cards.gl-on .card.gl-reveal .card__media,
.strip--cards.gl-on .card.gl-reveal .card__title,
.strip--cards.gl-on .card.gl-reveal .card__sub { opacity: 1; }
.strip--cards.gl-on .card--texto.gl-reveal { background: var(--red); }
.gl-canvas { position: absolute; z-index: 10; pointer-events: none; }
/* Perfil LITE (móvil/tablet): el texto NO se rasteriza a textura — se
   pinta como DOM nítido a densidad nativa, por encima del canvas del
   efecto. media+grano+tinte siguen en la GL downscaleada. */
.strip--cards.gl-on.gl-lite .card__title,
.strip--cards.gl-on.gl-lite .card__sub {
	opacity: 1;
	position: relative;
	z-index: 11;
}
/* Cuerpo prose (card 00 y Sobre mí) en FULL: se mantiene como DOM nítido (no
   se rasteriza) para permitir scroll interno cuando el texto no cabe en el
   alto de la card. El título SÍ sigue rasterizado (tiembla con el efecto).
   En LITE ya lo cubre la regla de arriba. */
.strip--cards.gl-on .card--prose .card__sub {
	opacity: 1;
	position: relative;
	z-index: 11;
}
`;

export function createDomBridge({ onLayout, onFocusReveal }) {
	const strip = document.querySelector('.strip--cards');
	const track = strip.querySelector('.track');

	const style = document.createElement('style');
	style.dataset.gl = '';
	style.textContent = STYLE;
	document.head.append(style);

	const canvas = document.createElement('canvas');
	canvas.className = 'gl-canvas';
	canvas.setAttribute('aria-hidden', 'true');
	strip.append(canvas);

	const env = {
		canvas,
		track,
		strip,
		margin: 10,       // px CSS (config.margin, lo fija index)
		rect: null,       // rect del canvas en px CSS (track inflado en vertical)
		cardW: 0,
		cardH: 0,
		slotW: 0,
		sx: 1,            // escala CSS→buffer real (NUNCA usar dPR directo)
		bufferW: 0,
		bufferH: 0,
		dprCap: 2,
		scale: 1,
		centralCopy: 2,
		domText: false,   // LITE: el texto se pinta en DOM, no como textura GL
	};

	function instance(i) {
		return track.querySelector(`.card[data-copy="${env.centralCopy}"][data-index="${i}"]`);
	}

	function measure() {
		const tr = track.getBoundingClientRect();
		const c0 = instance(0)?.getBoundingClientRect();
		const c1 = instance(1)?.getBoundingClientRect();
		if (!c0 || !c1) return false;
		env.cardW = c0.width;
		env.cardH = c0.height;
		env.slotW = c1.left - c0.left;
		// centros FRACCIONALES de las 50 instancias en coords de contenido
		// (geometry.js usa offsetLeft enteros: insuficiente para registro
		// sub-píxel; medimos una vez y por frame es scroll.left exacto)
		env.centersFrac = [...track.querySelectorAll('.card')].map((el) => {
			const r = el.getBoundingClientRect();
			return r.left + r.width / 2 - tr.left + track.scrollLeft;
		});
		// canvas = rect del track, inflado solo en vertical (sitio del temblor;
		// el clip LATERAL del track se respeta — los quads no invaden el gutter)
		const stripRect = strip.getBoundingClientRect();
		env.rect = {
			left: tr.left - stripRect.left,
			top: tr.top - stripRect.top - env.margin,
			width: tr.width,
			height: tr.height + env.margin * 2,
		};
		canvas.style.left = `${env.rect.left}px`;
		canvas.style.top = `${env.rect.top}px`;
		canvas.style.width = `${env.rect.width}px`;
		canvas.style.height = `${env.rect.height}px`;
		const dpr = Math.min(devicePixelRatio || 1, env.dprCap) * env.scale;
		env.bufferW = Math.max(2, Math.round(env.rect.width * dpr));
		env.bufferH = Math.max(2, Math.round(env.rect.height * dpr));
		env.sx = env.bufferW / env.rect.width;
		canvas.width = env.bufferW;
		canvas.height = env.bufferH;
		return true;
	}

	// re-medición: resize del track, cambio de dPR (zoom/monitor)
	let pending = 0;
	const requestLayout = () => {
		clearTimeout(pending);
		pending = setTimeout(() => {
			if (measure()) onLayout();
		}, 80);
	};
	new ResizeObserver(requestLayout).observe(track);
	let dprQuery;
	const armDpr = () => {
		dprQuery?.removeEventListener('change', onDpr);
		dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
		dprQuery.addEventListener('change', onDpr);
	};
	const onDpr = () => {
		armDpr();
		requestLayout();
	};
	armDpr();

	// focus-reveal: la card con foco vuelve a pintarse en DOM
	let revealed = null;
	track.addEventListener('focusin', (e) => {
		const card = e.target.closest?.('.card');
		if (!card) return;
		revealed?.classList.remove('gl-reveal');
		revealed = card;
		card.classList.add('gl-reveal');
		onFocusReveal(Number(card.dataset.index));
	});
	track.addEventListener('focusout', (e) => {
		if (revealed && !track.contains(e.relatedTarget)) {
			revealed.classList.remove('gl-reveal');
			revealed = null;
			onFocusReveal(-1);
		} else if (revealed && !revealed.contains(e.relatedTarget)) {
			revealed.classList.remove('gl-reveal');
			revealed = null;
			onFocusReveal(-1);
		}
	});

	return {
		env,
		canvas,
		instance,
		measure,
		on: () => {
			strip.classList.add('gl-on');
			strip.classList.toggle('gl-lite', !!env.domText);
		},
		off: () => strip.classList.remove('gl-on'),
		isOn: () => strip.classList.contains('gl-on'),
		destroy() {
			strip.classList.remove('gl-on', 'gl-lite');
			canvas.remove();
			style.remove();
		},
	};
}
