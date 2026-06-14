// ═══════════════════════════════════════════════════════════════════
// SHADER DEL CURSOR CINÉTICO — un solo programa, dos modos (uMode):
//   0 = cuadrado base (sólido; color reposo ↔ rojo de hover, alpha 1)
//   1 = speck de la estela (grano que se disuelve, borde sucio por noise)
//
// Hereda la MATERIA del efecto-firma: mismo hash12, misma textura PNG de
// grano y mismo value-noise (uGrain/uNoise), misma config.grain
// (amount/boost/size) y el mismo reseed a config.grain.clockFps (uGrainSeed).
// vPx = px del fragmento en el buffer → grano/noise en screen-space (igual
// que lens.js), para que la estela sea la misma "materia sucia".
// Salida premultiplicada (rgb·a, a) — blend ONE / ONE_MINUS_SRC_ALPHA.
// ═══════════════════════════════════════════════════════════════════

export const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;   // px del buffer
uniform vec4 uRect;  // x,y,w,h del quad en px de buffer (y hacia abajo)
out vec2 vUv;
out vec2 vPx;
void main() {
	vUv = aPos;
	vec2 px = uRect.xy + aPos * uRect.zw;
	vPx = px;
	vec2 clip = (px / uRes) * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vPx;
out vec4 o;

uniform int uMode;        // 0 = cuadrado base · 1 = speck de la estela
uniform vec3 uColor;      // color del cuadrado / tinte del grano de la estela
uniform float uAlpha;     // cuadrado = 1 · speck = vida restante (decae)
uniform sampler2D uGrain; // PNG speckle de Fase 1 (REPEAT)
uniform sampler2D uNoise; // value-noise 256² (REPEAT)
uniform vec2 uGrainSeed;  // reloj de grano (reseed a clockFps)
uniform float uGrainAmount;
uniform float uGrainBoost;
uniform float uGrainSize;
uniform float uTurb;      // turbulencia: rompe el contorno del speck
uniform float uSeed;      // semilla del speck (decorrelación entre puntos)

float hash12(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
	if (uMode == 0) {
		// cuadrado base sólido (premultiplicado)
		o = vec4(uColor * uAlpha, uAlpha);
		return;
	}
	// ── speck de la estela: disco de grano de borde sucio que se disuelve ──
	float r = length((vUv - 0.5) * 2.0);                 // 0 centro -> 1 borde
	float nz = texture(uNoise, vPx * 0.01 + uGrainSeed).r;
	float mask = 1.0 - smoothstep(0.4, 1.0, r + (nz - 0.5) * uTurb);
	if (mask <= 0.001) { o = vec4(0.0); return; }
	// grano: PNG speckle + hash, misma materia que lens.js (screen-space).
	// 256 = tamaño del tile PNG; 0.45 = piso de visibilidad (estructural).
	float speck = texture(uGrain, vPx / (uGrainSize * 256.0) + uGrainSeed).a;
	float g = speck * uGrainAmount + (hash12(vPx + uSeed) - 0.5) * uGrainBoost;
	float a = clamp(mask * uAlpha * (0.45 + g), 0.0, 1.0);
	o = vec4(uColor * a, a);                              // premultiplicado
}`;
