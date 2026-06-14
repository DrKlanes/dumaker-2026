// ═══════════════════════════════════════════════════════════════════
// PASE DE LENTE GLOBAL (pase 2) — fisheye de pantalla + grano reactivo.
// Toma la escena ya compuesta (todas las cards en el FBO del pase 1) y:
//   1) la muestrea con un remapeo barrel (centro plano, curvatura hacia
//      los filos del viewport) — el OJO DE PEZ.
//   2) espolvorea el GRANO sobre el píxel ya curvado (screen-space, tras
//      el warp) — así el fisheye no estira los puntos en vetas.
//   3) aplica el GRUNGE (overlay de mugre, screen-space, enmascarado a los
//      filos) — capa plana sobre la "pantalla", tampoco se curva.
//
// CONTRATO / INTERFAZ (para intercambiar/mejorar este pase en aislado):
//   Entrada:  target.color = textura del FBO con la escena compuesta.
//   Lo alimenta: cardsLayer.render → lens.draw(target, fisheye, splitW, gx).
//     · fisheye = preset.fisheye {amount, start, squeeze}
//     · gx = { grainTex, grain(preset.grain), curve(preset.curve),
//              grainSeed (reloj de grano), velBoost (velocidad suavizada),
//              grungeTex, grunge(preset.grunge), grungeState (salto del ticker) }
//   Señales del contrato (vía gx): grainSeed y velBoost vienen del ticker;
//     la curva permite reconstruir el k per-card como función de pantalla
//     (k = curveK(|nx|·edgeRef)), que es la misma graduación anclada al
//     viewport que usa el pase por-card.
//   TODOS los valores de look vienen de preset.json; sin hardcode aquí.
//   amount=0 → curvatura identidad (passthrough); el grano sigue aplicándose.
//   Screen-space → anclado al viewport por construcción (filo = x=±1).
// ═══════════════════════════════════════════════════════════════════

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
	vUv = aPos;
	gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uGrain;   // PNG speckle de Fase 1 (REPEAT)
uniform float uAmount;  // curvatura. SIGNO = dirección: >0 afuera, <0 adentro
uniform float uStart;   // radio del centro plano (0..1 en x)
uniform float uSqueeze; // compresión horizontal de la lente (preset.fisheye.squeeze)
uniform vec2 uRes;      // px del buffer (grano a tamaño de pantalla)
// grano reactivo (screen-space)
uniform float uGrainAmount;
uniform float uGrainBoost;
uniform float uGrainSize;
uniform vec2 uGrainSeed;
uniform float uVel;     // boost de velocidad (global)
// curva: k en screen-space = curveK(|nx|·edgeRef) — igual que per-card
uniform float uCurveStart;
uniform float uCurveEnd;
uniform float uCurvePower;
uniform float uEdgeRef;
// grunge screen-space (overlay, tras el warp — plano, no se curva)
uniform sampler2D uGrunge;
uniform float uGrungeAmount;
uniform float uGrungeZoom;
uniform vec2 uGrungeOff;
uniform float uGrungeRot;
uniform float uGrungeFlip;
uniform float uGrungeMaskStart;
uniform float uGrungeMaskEnd;

float hash12(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float curveK(float d) {
	float t = clamp((d - uCurveStart) / (uCurveEnd - uCurveStart), 0.0, 1.0);
	return pow(t * t * (3.0 - 2.0 * t), uCurvePower);
}
vec3 overlay(vec3 b, vec3 s) {
	return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}

void main() {
	vec2 c = vUv - 0.5;
	float nx = c.x * 2.0;                          // -1..1 horizontal
	float w = smoothstep(uStart, 1.0, abs(nx));    // 0 centro -> 1 filo
	float bend = uAmount * w;
	// CAPA 5 (fisheye): arqueo de la fila (barrel) + compresión horizontal
	vec2 src;
	src.y = 0.5 + (vUv.y - 0.5) * (1.0 + bend);
	src.x = 0.5 + (vUv.x - 0.5) * (1.0 - bend * uSqueeze);
	vec4 col = texture(uScene, src);               // CLAMP: margen transparente
	if (col.a < 0.004) { o = col; return; }        // hueco: nada de grano

	// ── CAPA 2: grano reactivo en ESPACIO DE PANTALLA (tras el warp) ──
	// intensidad anclada al viewport: gradeDist = |nx|·edgeRef (= per-card).
	// 256 = tamaño del tile PNG; 517 = decorrelación del hash; 0.55/0.35 =
	// escala interna de grain.amount/boost (estructurales, no son knobs).
	float kg = curveK(abs(nx) * uEdgeRef) * (1.0 + uVel);
	vec2 spx = vUv * uRes;
	float speck = texture(uGrain, spx / (uGrainSize * 256.0) + uGrainSeed).a;
	float g = speck * uGrainAmount * 0.55;
	g += (hash12(spx + uGrainSeed * 517.0) - 0.5) * uGrainBoost * 0.35;
	col.rgb = clamp(col.rgb + g * kg * col.a, vec3(0.0), vec3(col.a)); // premultiplied

	// ── CAPA 6: grunge screen-space (overlay), tras el warp — mugre plana ──
	// máscara anclada al viewport (= grano): centro limpio, filos sucios.
	float gm = smoothstep(uGrungeMaskStart, uGrungeMaskEnd, abs(nx) * uEdgeRef);
	if (uGrungeAmount > 0.0 && gm > 0.001) {
		// muestreo transformado: zoom (textura > área) + rotación + flip +
		// offset; todo acotado en CPU para no salir de [0,1] (sin cantos).
		vec2 gp = vUv - 0.5;
		if (uGrungeFlip > 0.5) gp.x = -gp.x;
		gp /= max(uGrungeZoom, 1.0);
		float cr = cos(uGrungeRot), sr = sin(uGrungeRot);
		vec2 guv = vec2(gp.x * cr - gp.y * sr, gp.x * sr + gp.y * cr) + 0.5 + uGrungeOff;
		float gr = texture(uGrunge, guv).r;
		vec3 rgb = col.rgb / max(col.a, 0.0001);             // des-premultiplicar
		rgb = mix(rgb, overlay(rgb, vec3(gr)), uGrungeAmount * gm);
		col.rgb = rgb * col.a;                               // re-premultiplicar
	}

	o = col;
}`;

export function createLens(mgl) {
	const prog = mgl.createProgram(VERT, FRAG);
	return {
		// dibuja la escena (target.color) a pantalla con warp + grano
		draw(target, fisheye, splitW, gx) {
			mgl.bindScreen();
			mgl.frame(target.w, target.h);
			if (splitW) mgl.setScissor(0, 0, splitW, target.h);
			prog.use();
			mgl.bind(target.color, 0);
			prog.u1i('uScene', 0);
			prog.u1f('uAmount', fisheye?.amount ?? 0);
			prog.u1f('uStart', fisheye?.start ?? 0.35);
			prog.u1f('uSqueeze', fisheye?.squeeze ?? 0.18);
			prog.u2f('uRes', target.w, target.h);
			if (gx?.grainTex) {
				mgl.bind(gx.grainTex, 1);
				prog.u1i('uGrain', 1);
			}
			prog.u1f('uGrainAmount', gx?.grain?.amount ?? 0);
			prog.u1f('uGrainBoost', gx?.grain?.boost ?? 0);
			prog.u1f('uGrainSize', gx?.grain?.size ?? 1);
			prog.u2f('uGrainSeed', gx?.grainSeed?.[0] ?? 0, gx?.grainSeed?.[1] ?? 0);
			prog.u1f('uVel', gx?.velBoost ?? 0);
			prog.u1f('uCurveStart', gx?.curve?.start ?? 0);
			prog.u1f('uCurveEnd', gx?.curve?.end ?? 1);
			prog.u1f('uCurvePower', gx?.curve?.power ?? 1);
			prog.u1f('uEdgeRef', gx?.curve?.edgeRef ?? 1.6);
			// grunge (overlay screen-space); sin textura → amount 0 (no se aplica)
			const hasGrunge = !!gx?.grungeTex;
			if (hasGrunge) { mgl.bind(gx.grungeTex, 2); prog.u1i('uGrunge', 2); }
			prog.u1f('uGrungeAmount', hasGrunge ? (gx?.grunge?.amount ?? 0) : 0);
			prog.u1f('uGrungeZoom', gx?.grunge?.zoom ?? 2);
			prog.u2f('uGrungeOff', gx?.grungeState?.ox ?? 0, gx?.grungeState?.oy ?? 0);
			prog.u1f('uGrungeRot', gx?.grungeState?.rot ?? 0);
			prog.u1f('uGrungeFlip', gx?.grungeState?.flip ?? 0);
			prog.u1f('uGrungeMaskStart', gx?.grunge?.maskStart ?? 0.5);
			prog.u1f('uGrungeMaskEnd', gx?.grunge?.maskEnd ?? 1.5);
			mgl.drawQuad();
			if (splitW) mgl.setScissor(null);
		},
	};
}
