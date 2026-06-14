// ═══════════════════════════════════════════════════════════════════
// CALIBRACIÓN DEL EFECTO-FIRMA — todos los valores son uniforms en vivo
// (cambiar un número aquí o en el panel ?gl=debug NO recompila shaders).
// k = smoothstep(curve.start, curve.end, absDist) ^ curve.power
//   0 = card centrada limpia · 1 = degradación plena hacia el borde
// ═══════════════════════════════════════════════════════════════════

export const config = {
	// curva de degradación por distancia al centro
	// CALIBRACIÓN MOISÉS (ronda 1): curva larga y casi lineal — los
	// vecinos se mantienen legibles; la corrupción plena queda lejos
	curve: {
		start: 0.23,   // absDist donde empieza a degradarse (la card aguanta limpia cerca del centro)
		end: 2.44,     // absDist de degradación plena (la vecina está en 1.0)
		power: 1.05,   // >1 = arranque suave, mordida rápida al final
		// ANCLAJE AL VIEWPORT: posición de curva en la que cae el borde físico
		// de la pantalla, sea cual sea el monitor. La graduación usa
		// (absDist × edgeRef / half-capacity), así el borde se comporta igual
		// en laptop / Full HD / ultrawide. Default ≈ half-capacity de Full HD
		// (~1.6): reproduce esas pantallas y alinea ultrawide con ellas.
		edgeRef: 1.6,
	},

	// capa 1 — tinte rojo multiply ("papel que se pudre")
	tint: {
		color: [0.62, 0.04, 0.05], // rojo-sangre del viraje (sRGB 0..1; calibrar tono)
		amount: 1.08,              // intensidad global del viraje
		darken: 0.39,              // hundimiento de los oscuros a casi negro
		gamma: 1.62,               // curva de contraste del hundimiento
		textCard: 0.45,            // factor para la card 00 (ya roja: no sobresaturar)
		srgb: 1,                   // 1 = multiply en sRGB (como compone Figma) · 0 = linear
	},

	// capa 2 — grano reactivo (el grano base de Fase 1, agravándose)
	grain: {
		amount: 0.77,  // intensidad del speckle base (PNG fase 1) con k
		boost: 0.38,   // grano procedural fino adicional con k
		size: 1.0,     // escala del speckle (1 = como fase 1)
		clockFps: 16,  // latido del grano (reseed/s) — desacoplado del frame rate
	},

	// capa 3 — glitch analógico de cinta (bandas dirigidas desde CPU)
	glitch: {
		amount: 1.27,     // intensidad global de los desplazamientos
		bandRate: 3.2,    // eventos de banda por segundo a k=1
		bandMaxH: 0.04,   // alto máximo de banda (fracción de card)
		bandMaxOff: 0.04, // desplazamiento máximo (fracción de ancho)
		bandTtl: 0.18,    // vida de una banda (s)
		roll: 1.05,       // rolling vertical de señal vieja (px de amplitud a k=1)
		rollSpeed: 0.55,  // velocidad del rolling (Hz)
	},

	// capa 4 — temblor del borde de la card (vínculo con la línea de Fase 1)
	// calibrado a vibración fina y rápida (poca amplitud, mucha frecuencia)
	tremor: {
		amount: 1.6,   // amplitud máxima en px a k=1 (≤ margin)
		freq: 200.0,   // frecuencia del ruido a lo largo del borde
		speed: 23.5,   // ticks de fase por segundo (mismo idioma que el glitch)
	},

	// modulación por velocidad de scroll (da vida; desactivable con gain 0)
	// gain alto: el efecto respira FUERTE al moverse, se asienta en reposo
	velocity: {
		gain: 1.72,   // cuánto suma la velocidad a k (0 = off)
		cap: 1.2,     // tope del boost
		tauUp: 0.12,  // s — respuesta al acelerar
		tauDown: 0.4, // s — caída al frenar (lenta, se asienta)
		norm: 2200,   // px/s que equivalen a boost 1.0 antes de gain
	},

	// reposo y sueño del ticker
	idle: {
		sleepVel: 1.5,     // px/s por debajo de los cuales se puede dormir
		sleepAfterMs: 4000 // grano vivo este tiempo tras asentarse; luego frame congelado
	},

	// perfiles de rendimiento
	profiles: {
		FULL: { dprCap: 2, scale: 1.0 },
		LITE: { dprCap: 1, scale: 0.75 }, // móvil: solo tinte+grano (shader aparte)
	},

	// margen del quad alrededor de la card (sitio para el temblor), px CSS
	margin: 10,
};

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
