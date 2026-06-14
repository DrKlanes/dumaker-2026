// Política de ticker — desviación deliberada del brief (aprobada):
// nada de retain() permanente. En movimiento la GL renderiza DENTRO del
// callback de subscribe (un solo rAF, cero lag, full-rate). En reposo late
// un reloj propio (~12-16fps, config.grain.clockFps) DESACOPLADO del frame
// rate. Reposo VIVO en desktop (perpetualIdle): el efecto sigue latiendo
// despacio para siempre (grano hirviendo, temblor, grunge a saltos) — señal
// de vídeo viva que no se apaga al soltar el ratón. Cortes de seguridad:
// pestaña oculta para del todo (visibilitychange); móvil/tablet, reduced y
// demote duermen tras idle.sleepAfterMs (batería / equipos modestos / a11y).
import { config } from './config.js';

export function createTicker(centerline, layer, { onDemote, reduced, perpetualIdle }) {
	let perpetual = !!perpetualIdle; // reposo vivo (desktop); demote() lo apaga
	let vel = 0; // suavizado propio por-tiempo (la EMA del contrato es por-frame)
	let lastT = 0;
	let grainSeed = [0.31, 0.74];
	let lastGrain = 0;
	let tremorPhase = 0;
	let rollPhase = 0;
	let grunge = { ox: 0, oy: 0, rot: 0, flip: 0 }; // estado del grunge (salta a grunge.fps)
	let lastGrunge = 0;
	let idleClock = 0;
	let settledAt = 0;
	let state = 'SLEEP';
	let stopped = false;
	let slowFrames = 0;

	function timing(now) {
		const dt = Math.min((now - lastT) / 1000 || 0.016, 0.1);
		lastT = now;
		if (!reduced) {
			if (now - lastGrain > 1000 / config.grain.clockFps) {
				grainSeed = [Math.random(), Math.random()];
				lastGrain = now;
			}
			tremorPhase += dt * config.tremor.speed;
			rollPhase += dt * config.glitch.rollSpeed * Math.PI * 2;
			if (config.grunge && now - lastGrunge > 1000 / config.grunge.fps) {
				grunge = nextGrungeState(); // salto a baja frecuencia (no se interpola)
				lastGrunge = now;
			}
		}
		const velBoost = reduced ? 0 : Math.min(vel / config.velocity.norm, config.velocity.cap) * config.velocity.gain;
		return { dt, now, grainSeed, tremorPhase, rollPhase, velBoost, reduced, grunge };
	}

	// transformación del grunge ACOTADA al margen seguro: con zoom Z y ángulo
	// θ, la ventana muestreada (semilado 0.5/Z) rotada alcanza (0.5/Z)(|cos|+
	// |sin|); el offset se limita a 0.5 − ese alcance → guv ∈ [0,1] SIEMPRE
	// (nunca asoma un canto). El wiggle "extremo" se habilita subiendo el zoom.
	function nextGrungeState() {
		const g = config.grunge;
		const rot = (Math.random() * 2 - 1) * (g.wiggleRot * Math.PI / 180);
		const z = Math.max(1.0001, g.zoom);
		const reach = (0.5 / z) * (Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot)));
		const offMax = Math.max(0, 0.5 - reach) * g.wigglePos;
		return {
			ox: (Math.random() * 2 - 1) * offMax,
			oy: (Math.random() * 2 - 1) * offMax,
			rot,
			flip: Math.random() < 0.5 ? 0 : 1,
		};
	}

	function updateVel(rawV, dt) {
		const target = Math.abs(rawV);
		const tau = target > vel ? config.velocity.tauUp : config.velocity.tauDown;
		vel += (target - vel) * (1 - Math.exp(-dt / tau));
	}

	function idleTick() {
		if (stopped || state !== 'IDLE') return;
		const now = performance.now();
		// los overrides del panel de calibración mantienen el reloj despierto
		const held = layer.overrides && (layer.overrides.velocity != null || layer.overrides.absDist != null);
		// dormir: bajo reduced (nada anima), o sin reposo vivo (móvil/demote)
		// tras idle.sleepAfterMs. En desktop con reposo vivo NO se duerme:
		// late eterno a clockFps. El panel (held) lo mantiene despierto.
		const timedOut = vel < config.idle.sleepVel && now - settledAt > config.idle.sleepAfterMs;
		if (!held && (reduced || (!perpetual && timedOut))) {
			state = 'SLEEP'; // frame congelado
			return;
		}
		const t = timing(now);
		updateVel(0, t.dt);
		layer.render(centerline.getSnapshot(), t);
		idleClock = setTimeout(() => requestAnimationFrame(idleTick), 1000 / config.grain.clockFps);
	}

	function scheduleIdle() {
		state = 'IDLE';
		clearTimeout(idleClock);
		idleClock = setTimeout(() => requestAnimationFrame(idleTick), 1000 / config.grain.clockFps);
	}

	const unsub = centerline.subscribe((s) => {
		if (stopped) return;
		clearTimeout(idleClock);
		const t = timing(performance.now());
		updateVel(s.velocity.px, t.dt);
		layer.render(s, t);
		if (!s.settled) {
			state = 'MOVING';
			// watchdog: solo muestrea en fase full-rate (no se auto-envenena)
			if (t.dt > 1 / 45) {
				if (++slowFrames > 90) {
					slowFrames = 0;
					onDemote();
				}
			} else {
				slowFrames = Math.max(0, slowFrames - 2);
			}
		} else {
			settledAt = performance.now();
			scheduleIdle();
		}
	}, { order: 50 });

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			clearTimeout(idleClock);
			state = 'SLEEP';
		} else if (!stopped) {
			settledAt = performance.now();
			scheduleIdle();
		}
	});

	return {
		renderOnce() {
			layer.render(centerline.getSnapshot(), timing(performance.now()));
		},
		wake() {
			settledAt = performance.now();
			scheduleIdle();
		},
		stop() {
			stopped = true;
			clearTimeout(idleClock);
			unsub();
		},
		calm() { perpetual = false; }, // demote: la GPU sufre → reposo vuelve a dormir
		getState: () => state,
		getVel: () => vel,
	};
}
