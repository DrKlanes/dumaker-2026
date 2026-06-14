// ═══════════════════════════════════════════════════════════════════
// SHADER DEL CURSOR CINÉTICO — un cuadrado sólido y nada más.
// Sin rastro, sin borde: relleno uColor (rojo en reposo ↔ blanco en
// hover, interpolado por la CPU con ease-in-out) y alpha plano.
// Salida premultiplicada (rgb·a, a) — blend ONE / ONE_MINUS_SRC_ALPHA.
// ═══════════════════════════════════════════════════════════════════

export const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;   // px del buffer
uniform vec4 uRect;  // x,y,w,h del quad en px de buffer (y hacia abajo)
void main() {
	vec2 px = uRect.xy + aPos * uRect.zw;
	vec2 clip = (px / uRes) * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
	o = vec4(uColor * uAlpha, uAlpha); // premultiplicado
}`;
