// ═══════════════════════════════════════════════════════════════════
// SHADERS DEL CURSOR CINÉTICO — dos programas:
//
//  SQUARE_*  → el cuadrado base (quad). Relleno uColor + borde de
//              contraste uEdgeColor (grosor uEdgeW, 0 = sin borde). El
//              borde aparece en hover (B): hace que el cursor nunca se
//              pierda, ni sobre una mancha roja dentro de una foto.
//
//  POINTS_*  → la estela, como ENJAMBRE de puntos diminutos (gl.POINTS:
//              un solo draw-call para miles). Cada punto muestrea el PNG
//              de grano en screen-space (materia táctil, no discos), con
//              decay no lineal "con hold" (anclado) y peso propio por
//              semilla (irregular). El tamaño y la vida (cola larga) los
//              fija la CPU por punto.
//
// Salida premultiplicada (rgb·a, a) — blend ONE / ONE_MINUS_SRC_ALPHA.
// ═══════════════════════════════════════════════════════════════════

export const SQUARE_VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;   // px del buffer
uniform vec4 uRect;  // x,y,w,h del quad en px de buffer (y hacia abajo)
out vec2 vUv;
void main() {
	vUv = aPos;
	vec2 px = uRect.xy + aPos * uRect.zw;
	vec2 clip = (px / uRes) * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const SQUARE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec3 uColor;      // relleno (reposo cursor.color ↔ hover rojo/blanco)
uniform vec3 uEdgeColor;  // borde de contraste (color opuesto)
uniform float uEdgeW;     // grosor del borde (fracción del lado; 0 = sin borde)
uniform float uAlpha;
void main() {
	float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)); // 0 borde -> 0.5 centro
	vec3 col = (uEdgeW > 0.0 && d < uEdgeW) ? uEdgeColor : uColor;
	o = vec4(col * uAlpha, uAlpha);
}`;

export const POINTS_VERT = `#version 300 es
in vec2 aPos;     // px del buffer
in float aSize;   // px (gl_PointSize)
in float aLife;   // 0 nace .. 1 muere
in float aSeed;   // 0..1 (decorrelación entre puntos)
uniform vec2 uRes;
out float vLife;
out float vSeed;
void main() {
	vLife = aLife;
	vSeed = aSeed;
	vec2 clip = (aPos / uRes) * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	gl_PointSize = aSize;
}`;

export const POINTS_FRAG = `#version 300 es
precision highp float;
in float vLife;
in float vSeed;
out vec4 o;
uniform sampler2D uGrain;  // PNG speckle de Fase 1 (REPEAT)
uniform vec2 uGrainSeed;   // reloj de grano (reseed a clockFps)
uniform float uGrainSize;
uniform float uGrainAmount;
uniform vec3 uColor;

float hash11(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void main() {
	// grano táctil: el PNG en screen-space (gl_FragCoord), decorrelado por
	// semilla. 256 = tile PNG; 0.35 = piso de visibilidad (estructural).
	vec2 g = gl_FragCoord.xy / (uGrainSize * 256.0) + uGrainSeed + vSeed * 0.137;
	float speck = texture(uGrain, g).a;
	// decay no lineal CON HOLD: opaco casi toda su vida, cae al final →
	// sensación de "anclado" (la cola larga del ttl la fija la CPU).
	float fade = 1.0 - smoothstep(0.55, 1.0, vLife);
	float w = 0.55 + 0.45 * hash11(vSeed);               // peso propio (irregular)
	float a = clamp((0.35 + speck * uGrainAmount) * fade * w, 0.0, 1.0);
	if (a <= 0.01) { o = vec4(0.0); return; }
	o = vec4(uColor * a, a);                             // premultiplicado
}`;
