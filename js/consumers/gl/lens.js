// Pase de lente GLOBAL (ojo de pez de pantalla). Toma la escena ya
// compuesta (todas las cards visibles renderizadas a un FBO) y la
// muestrea con un remapeo barrel: centro plano, curvatura creciente
// hacia los filos LATERALES del viewport. Screen-space → anclado al
// viewport por construcción (el filo es siempre x=±1 en todo monitor),
// que es justo la consistencia que edgeRef da a la capa per-card.
// Es una capa que se SUMA: amount=0 → identidad (look idéntico al previo).

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
uniform float uAmount;  // intensidad de la curvatura
uniform float uStart;   // radio del centro plano (0..1 en x): hasta aquí, sin distorsión

void main() {
	vec2 c = vUv - 0.5;
	float nx = c.x * 2.0;                          // -1..1 horizontal
	float w = smoothstep(uStart, 1.0, abs(nx));    // 0 en el centro, 1 en el filo lateral
	float bend = uAmount * w;
	// arqueo de la fila: estira la vertical hacia los filos (barrel) +
	// leve compresión horizontal — "vieja lente", dominado por la horizontal
	vec2 src;
	src.y = 0.5 + (vUv.y - 0.5) * (1.0 + bend);
	src.x = 0.5 + (vUv.x - 0.5) * (1.0 - bend * 0.18);
	o = texture(uScene, src);                       // CLAMP: el margen es transparente
}`;

export function createLens(mgl) {
	const prog = mgl.createProgram(VERT, FRAG);
	return {
		// dibuja la escena (target.color) a pantalla con el warp aplicado
		draw(target, fisheye, splitW) {
			mgl.bindScreen();
			mgl.frame(target.w, target.h);
			if (splitW) mgl.setScissor(0, 0, splitW, target.h);
			prog.use();
			mgl.bind(target.color, 0);
			prog.u1i('uScene', 0);
			prog.u1f('uAmount', fisheye?.amount ?? 0);
			prog.u1f('uStart', fisheye?.start ?? 0.35);
			mgl.drawQuad();
			if (splitW) mgl.setScissor(null);
		},
	};
}
