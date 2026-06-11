// Política de ticker — desviación deliberada del brief (aprobada):
// nada de retain() permanente. En movimiento la GL renderiza DENTRO del
// callback de subscribe (un solo rAF, cero lag). En reposo late un reloj
// de grano propio (~12fps) y tras idle.sleepAfterMs duerme del todo:
// frame congelado, GPU y CPU a cero. El reloj de grano va DESACOPLADO
// del frame rate (12fps de grano es más fílmico y hace invisible la
// transición movimiento→reposo).
import { config } from './config.js';

export function createTicker(centerline, layer, { onDemote, reduced }) {
	let vel = 0; // suavizado propio por-tiempo (la EMA del contrato es por-frame)
	let lastT = 0;
	let grainSeed = [0.31, 0.74];
	let lastGrain = 0;
	let tremorPhase = 0;
	let rollPhase = 0;
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
		}
		const velBoost = Math.min(vel / config.velocity.norm, config.velocity.cap) * config.velocity.gain;
		return { dt, now, grainSeed, tremorPhase, rollPhase, velBoost };
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
		if (!held && vel < config.idle.sleepVel && now - settledAt > config.idle.sleepAfterMs) {
			state = 'SLEEP'; // el último frame de grano queda congelado
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
		getState: () => state,
		getVel: () => vel,
	};
}
