// ═══════════════════════════════════════════════════════════════════
// ANDAMIAJE DE CALIBRACIÓN del efecto-firma.
//
// La ÚNICA fuente de verdad del preset es ./preset.json — la web lo
// carga al arrancar (loadPreset) y el panel ?gl=debug lo exporta/importa
// en ese mismo formato. Aquí NO hay valores de preset baked: así no
// puede quedar una copia obsoleta en silencio. Si preset.json falta o
// está roto, la GL no arranca y caen las cards limpias de Fase 1.
//
// `config` se rellena en runtime (misma referencia que importan los
// módulos). k = smoothstep(curve.start, curve.end, gradeDist)^curve.power
// ═══════════════════════════════════════════════════════════════════

// Objeto vivo: lo importan cardsLayer/ticker/index/debug y loadPreset lo
// puebla in place antes del primer render.
export const config = {};

export async function loadPreset() {
	const res = await fetch(new URL('./preset.json', import.meta.url), { cache: 'no-cache' });
	if (!res.ok) throw new Error(`preset.json: HTTP ${res.status}`);
	const data = await res.json();
	Object.assign(config, data);
	return config;
}

// Esquema del panel de calibración (?gl=debug): ruta, min, max, paso
export const SCHEMA = [
	['curve.start', 0, 1, 0.01], ['curve.end', 0.2, 3, 0.01], ['curve.power', 0.3, 4, 0.05],
	['curve.edgeRef', 0.6, 3, 0.01],
	['tint.amount', 0, 2, 0.01], ['tint.darken', 0, 1.5, 0.01], ['tint.gamma', 0, 3, 0.01],
	['tint.textCard', 0, 1.5, 0.01], ['tint.srgb', 0, 1, 1],
	['tint.color.0', 0, 1, 0.005], ['tint.color.1', 0, 1, 0.005], ['tint.color.2', 0, 1, 0.005],
	['grain.amount', 0, 2, 0.01], ['grain.boost', 0, 2, 0.01], ['grain.size', 0.25, 4, 0.05],
	['grain.clockFps', 2, 30, 1],
	['glitch.amount', 0, 2, 0.01], ['glitch.bandRate', 0, 8, 0.1], ['glitch.bandMaxH', 0, 0.2, 0.005],
	['glitch.bandMaxOff', 0, 0.15, 0.002], ['glitch.bandTtl', 0.03, 1, 0.01],
	['glitch.roll', 0, 3, 0.05], ['glitch.rollSpeed', 0, 4, 0.05],
	['tremor.amount', 0, 9, 0.1], ['tremor.freq', 5, 200, 1], ['tremor.speed', 0, 30, 0.5],
	['velocity.gain', 0, 2, 0.01], ['velocity.cap', 0, 3, 0.05],
	['velocity.tauUp', 0.01, 0.5, 0.01], ['velocity.tauDown', 0.05, 2, 0.01], ['velocity.norm', 200, 6000, 50],
	['fisheye.amount', -1, 1, 0.005], ['fisheye.start', 0, 1, 0.01],
	['idle.sleepVel', 0.1, 20, 0.1], ['idle.sleepAfterMs', 500, 20000, 100],
];

export function getPath(obj, path) {
	return path.split('.').reduce((o, k) => o[k], obj);
}

export function setPath(obj, path, value) {
	const keys = path.split('.');
	const last = keys.pop();
	keys.reduce((o, k) => o[k], obj)[last] = value;
}
