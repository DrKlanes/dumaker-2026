// Render del menú y del track desde el modelo de datos.
// Siempre textContent — jamás innerHTML con datos del JSON.

const num = (i) => String(i).padStart(2, '0');

export function renderMenu(cards, menuEl) {
	menuEl.textContent = '';
	cards.forEach((card, i) => {
		const li = document.createElement('li');
		const a = document.createElement('a');
		a.className = 'menu__item';
		a.draggable = false; // evita el drag-and-drop nativo del <a> (rompía el arrastre del menú)
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

function fillCard(node, card, i, ahoraTexto) {
	const li = node.querySelector('li');
	li.dataset.index = i;
	li.dataset.id = card.id;
	if (card.layout === 'prose') li.classList.add('card--prose'); // cuerpo arriba, caja grande
	node.querySelector('[data-slot="number"]').textContent = num(i);
	node.querySelector('[data-slot="title"]').textContent = card.title;
	const sub = node.querySelector('[data-slot="sub"]');
	const subText = card.template === 'texto' && i === 0 ? ahoraTexto : card.subtitle;
	if (subText) sub.textContent = subText;
	else sub.remove();

	const img = node.querySelector('[data-slot="img"]');
	if (img) {
		img.src = card.asset;
		img.alt = card.alt;
	}
	const video = node.querySelector('[data-slot="video"]');
	if (video) {
		// src real lo gestiona consumers/video.js por distancia (data-src)
		video.dataset.src = card.asset;
		if (card.poster) video.poster = card.poster;
	}

	const link = node.querySelector('[data-slot="link"]');
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
	return li;
}

// Renderiza `copies` copias del set completo (loop infinito: la copia
// central es la canónica; las demás son clones aria-hidden).
export function renderTrack(cards, ahoraTexto, trackEl, copies = 1, templates = document) {
	trackEl.textContent = '';
	const central = Math.floor(copies / 2);
	for (let copy = 0; copy < copies; copy++) {
		cards.forEach((card, i) => {
			const tpl = templates.getElementById(`tpl-card-${card.template}`);
			const node = tpl.content.cloneNode(true);
			const li = fillCard(node, card, i, ahoraTexto);
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
