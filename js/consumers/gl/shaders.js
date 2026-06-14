// ═══════════════════════════════════════════════════════════════════
// SHADER POR-CARD del efecto-firma (pase 1: cada card visible → FBO).
// El pase 2 (fisheye global + grano screen-space) vive en lens.js.
//
// CONTRATO / INTERFAZ (para poder intercambiar o mejorar este shader de
// forma aislada sin tocar el resto del sistema):
//
//  Quién lo alimenta:  cardsLayer.js (render) — pone todos los uniforms.
//  Señales del contrato (centerline.js) que llegan ya cocinadas:
//    · uK   = curva(absDist)·(1+velocidad)  → intensidad del efecto por card
//             (0 = card centrada limpia, →1 hacia el borde). cardsLayer la
//             calcula con curveK(absDist·edgeRef) y el boost de velocidad.
//    · uBands[], uRollPhase, uTremPhase → fase temporal del glitch/temblor.
//  Valores de calibración: TODOS vienen de preset.json vía uniforms
//    (uTint*, uGlitchAmount, uRollWave, uTremAmp/Freq/AA, uGradColor/Extent,
//    uBg, uHoleColor...). NO hay valores de look hardcodeados aquí.
//  Salida: vec4 premultiplicado (rgb·alpha, alpha) al FBO.
//
//  Constantes que SÍ quedan en el shader (no son knobs de calibración):
//    · matemática estructural (0.5 centros, 2.0 rangos, gamma 2.2, 256 tile)
//    · coeficiente interno del darken (0.35) = mapeo del rango de uTintDarken
//
// Las 4 capas escalan con uK → UN gesto coherente, no filtros apilados.
// Perfil LITE (móvil): #define LITE — máscara recta + composición + tinte
// (glitch/temblor se omiten; el grano va siempre en lens.js).
// ═══════════════════════════════════════════════════════════════════

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

uniform sampler2D uMedia;  // imagen/vídeo de la card (o textura 1×1 del fondo sólido)
uniform sampler2D uLabel;  // número/título/subtítulo rasterizados (FULL)
uniform sampler2D uNoise;  // value noise precomputado para el temblor (REPEAT)

// por quad
uniform vec2 uQuad;      // px del quad (incluye margen)
uniform float uMargin;   // px de margen para el temblor
uniform float uK;        // curva(absDist) con velocidad integrada
uniform float uHasMedia;
uniform float uHasLabel;  // 0 en LITE: el texto va por DOM, no por textura
uniform float uIsText;   // card 00
uniform float uHide;     // focus-reveal: no pintar
uniform vec3 uBg;        // fondo card texto / fallback (preset.bgColor)
uniform vec3 uHoleColor; // color del "hueco de cinta" del glitch (preset.glitch.holeColor)
uniform vec2 uCoverS;    // object-fit: cover
uniform vec2 uCoverO;
uniform float uGradOn;
uniform vec2 uGradOrigin;
uniform vec3 uGradDir;   // dir.x, dir.y, 1/longitud (uv y-abajo); ángulo = preset.gradient.angleDeg
uniform vec3 uGradColor; // color del gradiente de legibilidad (preset.gradient.color)
uniform float uGradExtent; // hasta dónde llega el gradiente (preset.gradient.extent)
uniform vec4 uBands[6];  // glitch: y, alto, offset(uv), fuerza
uniform int uBandCount;

// globales de calibración
uniform float uFx;          // kill-switch global (paridad/split)
uniform vec3 uTintColor;
uniform float uTintAmount;
uniform float uTintDarken;
uniform float uTintGamma;
uniform float uTintText;
uniform float uSrgb;        // 1 = multiply en sRGB (como Figma) · 0 = linear
uniform float uGlitchAmount; // capa 3
uniform float uRollAmp;     // px de rolling vertical
uniform float uRollPhase;   // fase temporal del rolling
uniform float uRollWave;    // nº de ondas del rolling a lo alto de la card (preset.glitch.rollWave)
uniform float uTremAmp;     // px de temblor del borde — capa 4
uniform float uTremFreq;    // ciclos por card a lo largo del borde
uniform float uTremPhase;   // fase temporal del temblor
uniform float uTremAA;      // suavizado (px) del borde del temblor (preset.tremor.edgeAA)
// (el grano —capa 2— vive en lens.js, screen-space tras el warp)

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
	suv.y += sin(uRollPhase + cuv.y * uRollWave) * (uRollAmp / csz.y) * k;

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
	nz *= 2.0;            // estructural: lleva el ruido [0,1] a [-1,1]
	float aa = uTremAA;   // suavizado del borde (px)
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
		col = mix(uHoleColor, col, inX); // fuera de rango (glitch) = hueco de cinta
	} else {
		col = uBg; // card de texto (fondo sólido) — y fallback si falla la media
	}
	if (uGradOn > 0.5) {
		float t = clamp(dot(suv - uGradOrigin, uGradDir.xy) * uGradDir.z, 0.0, 1.0);
		float ga = 1.0 - smoothstep(0.0, uGradExtent, t);
		col = mix(col, uGradColor, ga); // gradiente de legibilidad (esquina inferior)
	}
	if (uHasLabel > 0.5) {
		vec4 lab = texture(uLabel, clamp(suv, 0.0, 1.0));
		lab.a *= inX;
		col = mix(col, lab.rgb, lab.a);
	}

	// ── CAPA 1: tinte rojo multiply — "el rojo se come la luz" ────────
	// claros viran al rojo de marca; oscuros se hunden a casi negro.
	float kt = k * uTintAmount * mix(1.0, uTintText, uIsText); // uIsText: card 00 atenúa
	float ktc = clamp(kt, 0.0, 1.0);
	vec3 c = (uSrgb > 0.5) ? col : pow(col, vec3(2.2));        // 2.2 = gamma sRGB (estructural)
	vec3 tc = (uSrgb > 0.5) ? uTintColor : pow(uTintColor, vec3(2.2));
	c *= mix(vec3(1.0), tc, ktc);                  // claros -> rojo
	c = pow(c, vec3(1.0 + kt * uTintGamma));       // oscuros -> se hunden
	c *= 1.0 - ktc * uTintDarken * 0.35;           // 0.35: escala interna del rango de uTintDarken
	col = (uSrgb > 0.5) ? c : pow(c, vec3(1.0 / 2.2));

	// ── CAPA 2: grano reactivo — vive en lens.js (screen-space, tras el
	// warp del fisheye, para que no se estire en vetas). Aquí no se aplica.

	o = vec4(clamp(col, 0.0, 1.0) * alpha, alpha); // salida premultiplicada al FBO
}`;
}
