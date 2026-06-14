// Panel de calibración en vivo (?gl=debug). Sliders desde el SCHEMA de
// config (uniforms en vivo, cero recompilación), presets en localStorage
// + export/import JSON, modo split GL/DOM, replay determinista del
// glitch, overrides de absDist/velocity y HUD de frame-time.
import { config, SCHEMA, getPath, setPath } from './config.js';

const LS_KEY = 'dumaker.gl.presets';

export function mount({ layer, ticker, bridge, centerline }) {
	const root = document.createElement('div');
	root.dataset.gl = '';
	root.style.cssText = `position:fixed;top:8px;right:8px;z-index:200;width:280px;max-height:92vh;
		overflow:auto;background:#0a0908;color:#fdfdfc;font:11px/1.5 "Chivo Mono",monospace;
		padding:10px;border:1px solid #f30004;opacity:.96`;
	document.body.append(root);

	const h = document.createElement('div');
	h.textContent = 'GL · CALIBRACIÓN';
	h.style.cssText = 'color:#f30004;font-weight:700;margin-bottom:8px;letter-spacing:.08em';
	root.append(h);

	let updateSwatch = () => {};
	const repaint = () => {
		updateSwatch();
		ticker.renderOnce();
		ticker.wake();
	};

	function row(label, input, value) {
		const r = document.createElement('label');
		r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0';
		const name = document.createElement('span');
		name.textContent = label;
		name.style.cssText = 'flex:1 0 auto;white-space:nowrap';
		r.append(name, input);
		if (value) r.append(value);
		root.append(r);
		return r;
	}

	// ── sliders del schema ──
	const sliders = [];
	for (const [path, min, max, step] of SCHEMA) {
		const input = document.createElement('input');
		input.type = 'range';
		input.min = min; input.max = max; input.step = step;
		input.value = getPath(config, path);
		input.style.cssText = 'width:110px;accent-color:#f30004';
		const val = document.createElement('span');
		val.textContent = (+input.value).toFixed(2);
		val.style.cssText = 'width:42px;text-align:right';
		input.addEventListener('input', () => {
			setPath(config, path, +input.value);
			val.textContent = (+input.value).toFixed(2);
			repaint();
		});
		sliders.push({ path, input, val });
		row(path, input, val);
	}

	// swatch del rojo-sangre del tint con hex en vivo (para cazar el tono)
	const swatch = document.createElement('span');
	swatch.style.cssText = 'width:28px;height:14px;border:1px solid #444;display:inline-block';
	const hexLabel = document.createElement('span');
	hexLabel.style.cssText = 'width:60px;text-align:right';
	updateSwatch = () => {
		const [r, g, b] = config.tint.color;
		const hex = '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
		swatch.style.background = hex;
		hexLabel.textContent = hex;
	};
	updateSwatch();
	row('tint.color (rojo-sangre)', swatch, hexLabel);

	// ── overrides y toggles ──
	function toggleRow(label, get, set) {
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = get();
		input.addEventListener('change', () => { set(input.checked); repaint(); });
		row(label, input);
		return input;
	}
	function overrideRow(label, min, max, step, set) {
		const enable = document.createElement('input');
		enable.type = 'checkbox';
		const input = document.createElement('input');
		input.type = 'range';
		input.min = min; input.max = max; input.step = step; input.value = (min + max) / 2;
		input.style.cssText = 'width:90px;accent-color:#f30004';
		const val = document.createElement('span');
		val.style.cssText = 'width:42px;text-align:right';
		val.textContent = '—';
		const apply = () => {
			set(enable.checked ? +input.value : null);
			val.textContent = enable.checked ? (+input.value).toFixed(2) : '—';
			repaint();
		};
		enable.addEventListener('change', apply);
		input.addEventListener('input', apply);
		const r = row(label, input, val);
		r.prepend(enable);
	}

	const sep = () => {
		const d = document.createElement('hr');
		d.style.cssText = 'border:0;border-top:1px solid #333;margin:8px 0';
		root.append(d);
	};

	sep();
	toggleRow('split GL|DOM', () => layer.overrides.split > 0, (v) => {
		layer.overrides.split = v ? 1 : 0;
		bridge.strip ?? null;
		document.querySelector('.strip--cards').classList.toggle('gl-on', !v ? true : false);
		// en split: DOM visible entero + GL solo en mitad izquierda (scissor)
		if (v) document.querySelector('.strip--cards').classList.remove('gl-on');
		else document.querySelector('.strip--cards').classList.add('gl-on');
	});
	toggleRow('fx off (paridad)', () => layer.overrides.fx === 0, (v) => { layer.overrides.fx = v ? 0 : 1; });
	overrideRow('absDist forzada', 0, 3, 0.01, (v) => { layer.overrides.absDist = v; });
	overrideRow('velocity forzada', 0, 2, 0.01, (v) => { layer.overrides.velocity = v; });

	// replay determinista del glitch: misma semilla en bucle
	let replayTimer = 0;
	toggleRow('replay glitch (seed loop)', () => replayTimer !== 0, (v) => {
		clearInterval(replayTimer);
		replayTimer = 0;
		if (v) {
			layer.reseed(777);
			replayTimer = setInterval(() => { layer.reseed(777); ticker.wake(); }, 2000);
		}
	});

	// atenuador de los overlays CSS de grano (solo debug; el real es la suma)
	const att = document.createElement('input');
	att.type = 'range'; att.min = 0; att.max = 1; att.step = 0.05; att.value = 1;
	att.style.cssText = 'width:110px;accent-color:#f30004';
	const attStyle = document.createElement('style');
	document.head.append(attStyle);
	att.addEventListener('input', () => {
		const f = +att.value;
		attStyle.textContent = `body::after{opacity:${0.2 * f} !important}.page::after{opacity:${0.13 * f} !important}`;
	});
	row('grano CSS base ×', att);

	// ── presets ──
	sep();
	const presetBar = document.createElement('div');
	presetBar.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
	const btn = (label, fn) => {
		const b = document.createElement('button');
		b.textContent = label;
		b.style.cssText = 'background:#222;color:#fdfdfc;border:1px solid #444;font:inherit;padding:2px 6px;cursor:pointer';
		b.addEventListener('click', fn);
		presetBar.append(b);
	};
	const syncSliders = () => {
		for (const s of sliders) {
			s.input.value = getPath(config, s.path);
			s.val.textContent = (+s.input.value).toFixed(2);
		}
		repaint();
	};
	btn('guardar', () => {
		const name = prompt('nombre del preset:');
		if (!name) return;
		const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
		all[name] = JSON.parse(JSON.stringify(config));
		localStorage.setItem(LS_KEY, JSON.stringify(all));
	});
	btn('cargar', () => {
		const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
		const name = prompt(`presets: ${Object.keys(all).join(', ') || '(ninguno)'}`);
		if (!name || !all[name]) return;
		Object.assign(config, all[name]);
		syncSliders();
	});
	btn('export', () => {
		navigator.clipboard?.writeText(JSON.stringify(config, null, 1));
		alert('config copiada al portapapeles');
	});
	btn('import', () => {
		const json = prompt('pega el JSON de config:');
		if (!json) return;
		try {
			Object.assign(config, JSON.parse(json));
			syncSliders();
		} catch {
			alert('JSON inválido');
		}
	});
	root.append(presetBar);

	// ── HUD de frame-time ──
	const hud = document.createElement('div');
	hud.style.cssText = 'margin-top:8px;color:#888';
	root.append(hud);
	let frames = 0;
	let acc = 0;
	let last = performance.now();
	centerline.subscribe(() => {
		const now = performance.now();
		acc += now - last;
		last = now;
		if (++frames >= 30) {
			hud.textContent = `${(1000 / (acc / frames)).toFixed(0)} fps · ${(acc / frames).toFixed(1)} ms · ${ticker.getState()} · vel ${ticker.getVel().toFixed(0)}`;
			frames = 0;
			acc = 0;
		}
	}, { order: 99 });
}
