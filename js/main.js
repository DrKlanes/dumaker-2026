// Orquestador único: carga datos → render → módulos del carrusel.
// Nadie importa main.js; main.js conoce a todos.
import { loadData } from './data/cards.js';
import { renderMenu, renderTrack, renderDataError } from './dom/render.js';

const COPIES = 1; // etapa 4: 5 copias para el loop infinito

async function boot() {
	const { cards, ahoraTexto, fatal } = await loadData();
	if (fatal) {
		renderDataError(fatal);
		return;
	}

	renderMenu(cards, document.querySelector('.menu'));
	renderTrack(cards, ahoraTexto, document.querySelector('.track'), COPIES);

	// estado activo inicial; la sincronización viva llega con el carrusel (etapa 4)
	const first = document.querySelector('.menu__item');
	first.classList.add('is-active');
	first.setAttribute('aria-current', 'true');
}

boot();
