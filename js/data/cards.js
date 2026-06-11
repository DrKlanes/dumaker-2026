// Carga y validación defensiva de los datos editables.
// Regla de oro: nunca lanzar, nunca página en blanco. Los errores se
// devuelven como datos para que main.js decida cómo mostrarlos.

const TEMPLATES = new Set(['poster', 'clip', 'texto']);
const HREF_OK = /^(https?:|\/|#)/;

async function fetchJSON(url) {
	// no-cache: la caché de GitHub Pages es agresiva y las ediciones
	// de Moisés deben verse al recargar
	const res = await fetch(url, { cache: 'no-cache' });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Error(`${url} no es JSON válido — ${e.message}. ` +
			'Recuerda: sin comas finales y sin comentarios.');
	}
}

function sanitizeCard(raw, i, seenIds, warnings) {
	const card = {
		id: typeof raw.id === 'string' && /^[a-z0-9-]+$/.test(raw.id) ? raw.id : `card-${i}`,
		title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : `Card ${i}`,
		template: TEMPLATES.has(raw.template) ? raw.template : 'texto',
		subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : null,
		asset: typeof raw.asset === 'string' ? raw.asset : null,
		poster: typeof raw.poster === 'string' ? raw.poster : null,
		alt: typeof raw.alt === 'string' ? raw.alt : '',
		href: typeof raw.href === 'string' && HREF_OK.test(raw.href) ? raw.href : null,
		newTab: raw.newTab === true,
	};
	if (!TEMPLATES.has(raw.template)) {
		warnings.push(`cards.json: la card ${i} tiene template "${raw.template}", debe ser poster|clip|texto. Usando "texto".`);
	}
	if (typeof raw.href === 'string' && !HREF_OK.test(raw.href)) {
		warnings.push(`cards.json: la card ${i} tiene un href no permitido ("${raw.href}"). Solo https:, /ruta o #. Ignorado.`);
	}
	if (card.template !== 'texto' && !card.asset) {
		warnings.push(`cards.json: la card ${i} (${card.template}) no tiene asset. Degradada a "texto".`);
		card.template = 'texto';
	}
	if (seenIds.has(card.id)) {
		warnings.push(`cards.json: id duplicado "${card.id}" en la card ${i}. Renombrado a "card-${i}".`);
		card.id = `card-${i}`;
	}
	seenIds.add(card.id);
	return card;
}

export async function loadData() {
	const warnings = [];
	let cards = [];
	let ahoraTexto = '';
	let fatal = null;

	try {
		const data = await fetchJSON('data/cards.json');
		const rawCards = Array.isArray(data.cards) ? data.cards : [];
		if (!Array.isArray(data.cards)) {
			warnings.push('cards.json: falta el array "cards".');
		}
		const seenIds = new Set();
		cards = rawCards
			.filter((c) => c && typeof c === 'object')
			.map((raw, i) => sanitizeCard(raw, i, seenIds, warnings));
		if (cards.length === 0) fatal = 'cards.json no contiene ninguna card válida.';
	} catch (e) {
		fatal = e.message;
	}

	try {
		const ahora = await fetchJSON('data/ahora.json');
		ahoraTexto = typeof ahora.texto === 'string' ? ahora.texto : '';
		if (!ahoraTexto) warnings.push('ahora.json: falta el campo "texto".');
	} catch (e) {
		// ahora.json roto no tumba la página: la card 00 sale sin cuerpo
		warnings.push(e.message);
	}

	for (const w of warnings) console.warn(w);
	return { cards, ahoraTexto, warnings, fatal };
}
