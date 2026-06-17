// Render del menú y del track como ENHANCER (progressive enhancement).
// El contenido canónico vive en el HTML estático (index.html) — indexable
// sin JS. Aquí lo ADOPTAMOS y le añadimos comportamiento; nunca duplicamos
// contenido. data/cards.json sigue siendo la fuente de verdad: reconciliamos
// los textos sobre los nodos existentes (editar el JSON + recargar se refleja).
//
// Fallback REGENERAR: si el HTML estático está desincronizado con el JSON
// (p. ej. se añade/quita una card sin re-bakear el estático), reconstruimos
// desde las <template> — el sitio sigue correcto, solo se pierde el snapshot
// SEO de ese estado hasta volver a bakear.
// Siempre textContent — jamás innerHTML con datos del JSON.

const num = (i) => String(i).padStart(2, '0');

// Rellena un <li> de card (existente o recién clonado de template) con los
// datos de la card. Idéntico resultado en ambos caminos (adoptar / regenerar).
function fillCard(li, card, i, ahoraTexto) {
	li.dataset.index = i;
	li.dataset.id = card.id;
	if (card.layout === 'prose') li.classList.add('card--prose'); // cuerpo arriba, caja grande
	li.querySelector('[data-slot="number"]').textContent = num(i);
	li.querySelector('[data-slot="title"]').textContent = card.title;
	const sub = li.querySelector('[data-slot="sub"]');
	const subText = card.template === 'texto' && i === 0 ? ahoraTexto : card.subtitle;
	if (sub) {
		if (subText) sub.textContent = subText;
		else sub.remove();
	}

	const img = li.querySelector('[data-slot="img"]');
	if (img) {
		img.src = card.asset;
		img.alt = card.alt;
	}
	const video = li.querySelector('[data-slot="video"]');
	if (video) {
		// src real lo gestiona consumers/video.js por distancia (data-src)
		video.dataset.src = card.asset;
		if (card.poster) video.poster = card.poster;
	}

	const link = li.querySelector('[data-slot="link"]');
	if (link) {
		if (card.href) {
			link.href = card.href;
			if (card.newTab) {
				link.target = '_blank';
				link.rel = 'noopener';
			}
		} else {
			// card sin destino: el título deja de ser enlace, sin romper nada
			const span = document.createElement('span');
			span.className = link.className;
			span.append(...link.childNodes);
			link.replaceWith(span);
		}
	}
}

export function renderMenu(cards, menuEl) {
	const items = [...menuEl.querySelectorAll('.menu__item')];
	if (items.length === cards.length) {
		// ADOPTAR: el menú ya vive en el HTML estático; reconciliar desde el JSON
		items.forEach((a, i) => {
			a.dataset.index = i;
			a.href = `#${cards[i].id}`;
			a.draggable = false; // evita el drag-and-drop nativo del <a>
			a.querySelector('b').textContent = num(i);
			a.querySelector('span').textContent = cards[i].title;
		});
		return;
	}
	// REGENERAR (fallback): estático ausente o desincronizado con cards.json
	menuEl.textContent = '';
	cards.forEach((card, i) => {
		const li = document.createElement('li');
		const a = document.createElement('a');
		a.className = 'menu__item';
		a.draggable = false;
		a.href = `#${card.id}`;
		a.dataset.index = i;
		const b = document.createElement('b');
		b.textContent = num(i);
		const span = document.createElement('span');
		span.textContent = card.title;
		a.append(b, span);
		li.append(a);
		menuEl.append(li);
	});
}

// Convierte una copia central recién reconciliada en una copia-clon del loop
// (aria-hidden, no tabbable, su propio data-copy).
function cloneCopy(srcLis, copy) {
	const frag = document.createDocumentFragment();
	for (const src of srcLis) {
		const clone = src.cloneNode(true);
		clone.dataset.copy = copy;
		clone.setAttribute('aria-hidden', 'true');
		clone.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; });
		frag.append(clone);
	}
	return frag;
}

// Renderiza `copies` copias del set completo (loop infinito: la copia
// central es la canónica; las demás son clones aria-hidden).
export function renderTrack(cards, ahoraTexto, trackEl, copies = 1, templates = document) {
	const central = Math.floor(copies / 2);
	const canonical = [...trackEl.children].filter((el) => el.matches?.('li.card'));

	if (canonical.length === cards.length) {
		// ADOPTAR: las cards canónicas ya están en el HTML estático. Reconciliar
		// cada una como copia central, y clonar el resto de copias del loop.
		canonical.forEach((li, i) => {
			fillCard(li, cards[i], i, ahoraTexto);
			li.dataset.copy = central;
		});
		const before = document.createDocumentFragment();
		const after = document.createDocumentFragment();
		for (let copy = 0; copy < copies; copy++) {
			if (copy === central) continue;
			const frag = copy < central ? before : after;
			frag.append(cloneCopy(canonical, copy));
		}
		trackEl.insertBefore(before, canonical[0]);
		trackEl.append(after);
		return;
	}

	// REGENERAR (fallback): estático ausente o desincronizado con cards.json
	trackEl.textContent = '';
	for (let copy = 0; copy < copies; copy++) {
		cards.forEach((card, i) => {
			const tpl = templates.getElementById(`tpl-card-${card.template}`);
			const node = tpl.content.cloneNode(true);
			const li = node.querySelector('li');
			fillCard(li, card, i, ahoraTexto);
			li.dataset.copy = copy;
			if (copy !== central) {
				li.setAttribute('aria-hidden', 'true');
				li.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; });
			}
			trackEl.append(node);
		});
	}
}

export function renderDataError(message) {
	const div = document.createElement('div');
	div.className = 'data-error';
	const h = document.createElement('p');
	h.textContent = 'Error en los datos';
	const p = document.createElement('p');
	p.textContent = message;
	div.append(h, p);
	document.body.append(div);
}
