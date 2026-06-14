// Shaders del efecto-firma. Un solo pase por quad. Las 4 capas escalan
// con k = curva(absDist)·(1+boost de velocidad) — UN gesto, no filtros.
// Perfil LITE (móvil): #define LITE — solo composición + tinte + grano 1-tap.

export const VERT = `#version 300 es
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

export function frag(lite) {
	return `#version 300 es
precision highp float;
${lite ? '#define LITE' : ''}
in vec2 vUv;
out vec4 o;

uniform sampler2D uMedia;
uniform sampler2D uLabel;
uniform sampler2D uGrain;  // PNG de grano de Fase 1 (REPEAT)
uniform sampler2D uNoise;  // value noise precomputado (REPEAT)

// por quad
uniform vec2 uQuad;      // px del quad (incluye margen)
uniform float uMargin;   // px de margen para el temblor
uniform float uK;        // curva(absDist) con velocidad integrada
uniform float uHasMedia;
uniform float uHasLabel;  // 0 en LITE: el texto va por DOM, no por textura
uniform float uIsText;   // card 00
uniform float uHide;     // focus-reveal: no pintar
uniform vec3 uBg;        // fondo card texto
uniform vec2 uCoverS;    // object-fit: cover
uniform vec2 uCoverO;
uniform float uGradOn;
uniform vec2 uGradOrigin;
uniform vec3 uGradDir;   // dir.x, dir.y, 1/longitud (uv y-abajo)
uniform vec4 uBands[6];  // glitch: y, alto, offset(uv), fuerza
uniform int uBandCount;

// globales de calibración
uniform float uFx;          // kill-switch global (paridad/split)
uniform vec3 uTintColor;
uniform float uTintAmount;
uniform float uTintDarken;
uniform float uTintGamma;
uniform float uTintText;
uniform float uSrgb;
uniform float uGrainAmount;
uniform float uGrainBoost;
uniform float uGrainSize;
uniform vec2 uGrainSeed;
uniform float uGlitchAmount;
uniform float uRollAmp;     // px
uniform float uRollPhase;
uniform float uTremAmp;     // px
uniform float uTremFreq;    // ciclos por card a lo largo del borde
uniform float uTremPhase;

float hash12(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
	if (uHide > 0.5) { o = vec4(0.0); return; }
	float k = clamp(uK, 0.0, 1.5) * uFx;

	vec2 px = vUv * uQuad;
	vec2 cpx = px - vec2(uMargin);
	vec2 csz = uQuad - 2.0 * vec2(uMargin);
	vec2 cuv = cpx / csz;
	vec2 suv = cuv;
	float alpha;

#ifdef LITE
	// máscara de borde recta y limpia
	alpha = step(0.0, cpx.x) * step(cpx.x, csz.x) * step(0.0, cpx.y) * step(cpx.y, csz.y);
	if (alpha <= 0.0) { o = vec4(0.0); return; }
#else
	// ── CAPA 3: glitch analógico — bandas (CPU-driven) + rolling ──────
	float dx = 0.0;
	for (int i = 0; i < 6; i++) {
		if (i >= uBandCount) break;
		vec4 b = uBands[i];
		float inBand = step(b.x, cuv.y) * step(cuv.y, b.x + b.y);
		dx += inBand * b.z * b.w;
	}
	suv.x += dx * uGlitchAmount * k;
	suv.y += sin(uRollPhase + cuv.y * 2.4) * (uRollAmp / csz.y) * k;

	// ── CAPA 4: temblor del borde — máscara analítica desplazada ──────
	// (no se tocan las UVs de muestreo: interior intacto, cero streaks)
	float tA = uTremAmp * k;
	float f = uTremFreq / 256.0;
	vec4 nz = vec4(
		texture(uNoise, vec2(cuv.y * f * 256.0 / 256.0, uTremPhase * 0.013)).r,
		texture(uNoise, vec2(cuv.y * f * 256.0 / 256.0, uTremPhase * 0.013 + 0.37)).g,
		texture(uNoise, vec2(cuv.x * f * 256.0 / 256.0, uTremPhase * 0.013 + 0.61)).b,
		texture(uNoise, vec2(cuv.x * f * 256.0 / 256.0, uTremPhase * 0.013 + 0.83)).a
	) - 0.5;
	nz *= 2.0;
	float aa = 0.75;
	float mL = smoothstep(nz.x * tA - aa, nz.x * tA + aa, cpx.x);
	float mR = 1.0 - smoothstep(csz.x + nz.y * tA - aa, csz.x + nz.y * tA + aa, cpx.x);
	float mT = smoothstep(nz.z * tA - aa, nz.z * tA + aa, cpx.y);
	float mB = 1.0 - smoothstep(csz.y + nz.w * tA - aa, csz.y + nz.w * tA + aa, cpx.y);
	alpha = mL * mR * mT * mB;
	if (alpha <= 0.002) { o = vec4(0.0); return; }
#endif

	// ── composición: media con cover + gradiente + label ──────────────
	vec3 col;
	float inX = step(0.0, suv.x) * step(suv.x, 1.0);
	if (uHasMedia > 0.5) {
		vec2 muv = clamp(suv, 0.0, 1.0) * uCoverS + uCoverO;
		col = texture(uMedia, muv).rgb;
		col = mix(vec3(0.02, 0.018, 0.016), col, inX); // hueco de cinta: oscuro
	} else {
		col = uBg;
	}
	if (uGradOn > 0.5) {
		float t = clamp(dot(suv - uGradOrigin, uGradDir.xy) * uGradDir.z, 0.0, 1.0);
		float ga = 1.0 - smoothstep(0.0, 0.466, t);
		col = mix(col, vec3(0.0392, 0.0353, 0.0314), ga); // #0a0908
	}
	if (uHasLabel > 0.5) {
		vec4 lab = texture(uLabel, clamp(suv, 0.0, 1.0));
		lab.a *= inX;
		col = mix(col, lab.rgb, lab.a);
	}

	// ── CAPA 1: tinte rojo multiply — el rojo se come la luz ──────────
	float kt = k * uTintAmount * mix(1.0, uTintText, uIsText);
	float ktc = clamp(kt, 0.0, 1.0);
	vec3 c = (uSrgb > 0.5) ? col : pow(col, vec3(2.2));
	vec3 tc = (uSrgb > 0.5) ? uTintColor : pow(uTintColor, vec3(2.2));
	c *= mix(vec3(1.0), tc, ktc);                  // claros -> rojo
	c = pow(c, vec3(1.0 + kt * uTintGamma));       // oscuros -> se hunden
	c *= 1.0 - ktc * uTintDarken * 0.35;
	col = (uSrgb > 0.5) ? c : pow(c, vec3(1.0 / 2.2));

	// ── CAPA 2: grano reactivo — el base de Fase 1, agravándose ───────
	float kg = k;
#ifdef LITE
	float h = hash12(px + uGrainSeed * 517.0) - 0.5;
	col += h * (uGrainAmount + uGrainBoost) * kg * 0.4;
#else
	vec2 gpx = px / uGrainSize;
	float speck = texture(uGrain, gpx / 256.0 + uGrainSeed).a;
	col += speck * uGrainAmount * kg * 0.55;
	float h = hash12(px + uGrainSeed * 517.0) - 0.5;
	col += h * uGrainBoost * kg * 0.35;
#endif

	o = vec4(clamp(col, 0.0, 1.0) * alpha, alpha); // premultiplied
}`;
}
