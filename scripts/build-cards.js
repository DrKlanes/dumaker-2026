#!/usr/bin/env node
'use strict';

// Generador del HTML estático de las cards (progressive enhancement).
// FUENTE ÚNICA DE VERDAD: data/cards.json. Reescribe SOLO la zona entre los
// marcadores de index.html (menú + track, copia central canónica), dejando
// intacto head/SEO, hero, claim, footer y <template>. Reproduce byte a byte
// el contrato de markup que el enhancer (js/dom/render.js, adopt path) espera.
//
// Lo corre la GitHub Action en cada deploy (antes de publicar el artifact):
// editar cards.json + push = HTML servido actualizado, sin tocar index.html.
// Determinista e idempotente: misma cards.json → mismo index.html, sin diffs.
//
// Reglas espejo de render.js / loadData:
//  - salta las cards con hidden:true (Lab)
//  - la card 00 (texto, índice 0) emite <p> VACÍO: su cuerpo es fuente única
//    de data/ahora.json (se rellena en runtime), nunca se bakea aquí
//  - enlace uniforme <a data-slot="link">; href/target solo si la card lo tiene
//
// Falla RUIDOSO (exit 1) ante cualquier problema → la Action en rojo, nunca
// publica un HTML a medias.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CARDS_JSON = path.join(ROOT, 'data', 'cards.json');
const INDEX_HTML = path.join(ROOT, 'index.html');
const CENTRAL_COPY = 2; // copia central del loop (COPIES=5 en js/main.js)

const MENU_START = 'menu:auto:start';
const MENU_END = '<!-- menu:auto:end -->';
const CARDS_START = 'cards:auto:start';
const CARDS_END = '<!-- cards:auto:end -->';

function fail(msg) {
	console.error(`[build-cards] ERROR: ${msg}`);
	process.exit(1);
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const num = (i) => String(i).padStart(2, '0');
const tabs = (n) => '\t'.repeat(n);

function loadCards() {
	let raw;
	try { raw = fs.readFileSync(CARDS_JSON, 'utf8'); }
	catch (e) { return fail(`no se pudo leer ${CARDS_JSON}: ${e.message}`); }
	let data;
	try { data = JSON.parse(raw); }
	catch (e) { return fail(`cards.json no es JSON válido: ${e.message}`); }
	if (!Array.isArray(data.cards)) return fail('cards.json: falta el array "cards"');
	return data.cards.filter((c) => c && typeof c === 'object' && c.hidden !== true);
}

function linkOpen(card) {
	let a = '<a class="card__link" data-slot="link" draggable="false"';
	if (typeof card.href === 'string' && card.href) {
		a += ` href="${escAttr(card.href)}"`;
		if (card.newTab === true) a += ' target="_blank" rel="noopener"';
	}
	return a + '>';
}

function classFor(card) {
	let cls = `card card--${card.template}`;
	if (card.layout === 'prose') cls += ' card--prose';
	return cls;
}

function menuItem(card, i) {
	return `${tabs(4)}<li><a class="menu__item" href="#${escAttr(card.id)}" data-index="${i}" draggable="false"><b>${num(i)}</b><span>${escText(card.title)}</span></a></li>`;
}

function trackCard(card, i) {
	const out = [];
	out.push(`${tabs(4)}<li class="${classFor(card)}" data-index="${i}" data-id="${escAttr(card.id)}" data-copy="${CENTRAL_COPY}">`);
	if (card.template === 'poster') {
		out.push(`${tabs(5)}<div class="card__media">`);
		out.push(`${tabs(6)}<img data-slot="img" loading="lazy" decoding="async" alt="${escAttr(card.alt || '')}" src="${escAttr(card.asset)}">`);
		out.push(`${tabs(5)}</div>`);
	} else if (card.template === 'clip') {
		out.push(`${tabs(5)}<div class="card__media">`);
		let v = `${tabs(6)}<video data-slot="video" muted playsinline loop preload="none" data-src="${escAttr(card.asset)}"`;
		if (typeof card.poster === 'string' && card.poster) v += ` poster="${escAttr(card.poster)}"`;
		out.push(v + '></video>');
		out.push(`${tabs(5)}</div>`);
	}
	out.push(`${tabs(5)}<h2 class="card__title"><b data-slot="number">${num(i)}</b>${linkOpen(card)}<span data-slot="title">${escText(card.title)}</span></a></h2>`);
	// card 00 (texto, índice 0): <p> vacío — cuerpo desde ahora.json en runtime.
	// resto: <p> con el subtítulo; sin subtítulo no se emite (fillCard lo quitaría).
	if (card.template === 'texto' && i === 0) {
		out.push(`${tabs(5)}<p class="card__sub" data-slot="sub"></p>`);
	} else if (typeof card.subtitle === 'string' && card.subtitle) {
		out.push(`${tabs(5)}<p class="card__sub" data-slot="sub">${escText(card.subtitle)}</p>`);
	}
	out.push(`${tabs(4)}</li>`);
	return out.join('\n');
}

// Reemplaza el contenido entre el marcador de apertura (comentario que contiene
// `startTag`) y el de cierre (`endComment` exacto), preservando ambos marcadores
// y la indentación. EOL detectado del propio archivo (no introduce CRLF/LF mixto).
function replaceZone(html, startTag, endComment, body, eol) {
	const re = new RegExp(`(<!-- ${startTag}[^>]*-->)[\\s\\S]*?(${endComment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
	if (!re.test(html)) return fail(`marcadores no encontrados: ${startTag} … ${endComment}`);
	const block = body.split('\n').join(eol);
	return html.replace(re, `$1${eol}${block}${eol}${tabs(4)}$2`);
}

function main() {
	const cards = loadCards();
	if (cards.length === 0) return fail('cards.json no contiene cards visibles');

	let html;
	try { html = fs.readFileSync(INDEX_HTML, 'utf8'); }
	catch (e) { return fail(`no se pudo leer ${INDEX_HTML}: ${e.message}`); }
	const eol = html.includes('\r\n') ? '\r\n' : '\n';

	const menu = cards.map(menuItem).join('\n');
	const track = cards.map(trackCard).join('\n');

	let next = replaceZone(html, MENU_START, MENU_END, menu, eol);
	next = replaceZone(next, CARDS_START, CARDS_END, track, eol);

	if (next === html) {
		console.log('[build-cards] sin cambios (index.html ya al día)');
		return;
	}
	fs.writeFileSync(INDEX_HTML, next);
	console.log(`[build-cards] OK · ${cards.length} cards generadas en index.html`);
}

main();
