// Pase de lente GLOBAL (ojo de pez de pantalla) + grano reactivo
// screen-space. Toma la escena ya compuesta (cards en el FBO), la
// muestrea con un remapeo barrel (centro plano, curvatura hacia los
// filos), y DESPUÉS espolvorea el grano sobre el píxel ya curvado — así
// el warp no estira los puntos de grano en vetas.
// Screen-space → anclado al viewport por construcción (filo = x=±1).
// amount=0 → curvatura identidad (el grano sigue aplicándose).

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

float hash12(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float curveK(float d) {
	float t = clamp((d - uCurveStart) / (uCurveEnd - uCurveStart), 0.0, 1.0);
	return pow(t * t * (3.0 - 2.0 * t), uCurvePower);
}

void main() {
	vec2 c = vUv - 0.5;
	float nx = c.x * 2.0;                          // -1..1 horizontal
	float w = smoothstep(uStart, 1.0, abs(nx));    // 0 centro -> 1 filo
	float bend = uAmount * w;
	// arqueo de la fila (barrel) + leve compresión horizontal
	vec2 src;
	src.y = 0.5 + (vUv.y - 0.5) * (1.0 + bend);
	src.x = 0.5 + (vUv.x - 0.5) * (1.0 - bend * 0.18);
	vec4 col = texture(uScene, src);               // CLAMP: margen transparente
	if (col.a < 0.004) { o = col; return; }        // hueco: nada de grano

	// ── grano reactivo en ESPACIO DE PANTALLA (tras el warp) ──────────
	// intensidad anclada al viewport: gradeDist = |nx|·edgeRef (= per-card)
	float kg = curveK(abs(nx) * uEdgeRef) * (1.0 + uVel);
	vec2 spx = vUv * uRes;
	float speck = texture(uGrain, spx / (uGrainSize * 256.0) + uGrainSeed).a;
	float g = speck * uGrainAmount * 0.55;
	g += (hash12(spx + uGrainSeed * 517.0) - 0.5) * uGrainBoost * 0.35;
	col.rgb = clamp(col.rgb + g * kg * col.a, vec3(0.0), vec3(col.a)); // premultiplied

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
			mgl.drawQuad();
			if (splitW) mgl.setScissor(null);
		},
	};
}
