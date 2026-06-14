// Helper WebGL2 mínimo y propio — la superficie que esta capa necesita y
// nada más: contexto, programas, un quad compartido, texturas (imagen,
// vídeo, canvas, datos) y scissor. Cláusula de escape documentada en el
// plan: si esto crece de ~300 líneas, se sustituye por OGL.

export function createGL(canvas) {
	const gl = canvas.getContext('webgl2', {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: true,
		powerPreference: 'high-performance',
	});
	if (!gl) return null;

	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // salida premultiplicada
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

	// quad unitario compartido (triangle strip, aPos en 0..1)
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);

	function compile(type, src) {
		const sh = gl.createShader(type);
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
		}
		return sh;
	}

	function createProgram(vsSrc, fsSrc) {
		const prog = gl.createProgram();
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
		gl.bindAttribLocation(prog, 0, 'aPos');
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
		}
		const locs = new Map();
		const loc = (name) => {
			if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
			return locs.get(name);
		};
		return {
			prog,
			use: () => gl.useProgram(prog),
			u1f: (n, x) => gl.uniform1f(loc(n), x),
			u2f: (n, x, y) => gl.uniform2f(loc(n), x, y),
			u3f: (n, x, y, z) => gl.uniform3f(loc(n), x, y, z),
			u4f: (n, x, y, z, w) => gl.uniform4f(loc(n), x, y, z, w),
			u1i: (n, x) => gl.uniform1i(loc(n), x),
			u4fv: (n, arr) => gl.uniform4fv(loc(n), arr),
		};
	}

	function createTexture({ wrap = gl.CLAMP_TO_EDGE, filter = gl.LINEAR } = {}) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		// 1px transparente hasta la primera subida: nunca textura incompleta
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
		return { tex, w: 1, h: 1, ready: false };
	}

	function upload(t, source) {
		gl.bindTexture(gl.TEXTURE_2D, t.tex);
		const w = source.videoWidth ?? source.naturalWidth ?? source.width;
		const h = source.videoHeight ?? source.naturalHeight ?? source.height;
		if (w === t.w && h === t.h && t.ready) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
			t.w = w;
			t.h = h;
		}
		t.ready = true;
	}

	function uploadData(t, data, w, h) {
		gl.bindTexture(gl.TEXTURE_2D, t.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		t.w = w;
		t.h = h;
		t.ready = true;
	}

	function bind(t, unit) {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, t.tex);
	}

	function frame(w, h) {
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	// render target (FBO + textura de color) para el pase de lente global
	function createTarget(w, h) {
		const fbo = gl.createFramebuffer();
		const color = createTexture({ filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE });
		const t = { fbo, color, w: 0, h: 0 };
		resizeTarget(t, w, h);
		return t;
	}

	function resizeTarget(t, w, h) {
		if (t.w === w && t.h === h) return;
		gl.bindTexture(gl.TEXTURE_2D, t.color.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		t.color.w = w;
		t.color.h = h;
		t.color.ready = true;
		gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.color.tex, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		t.w = w;
		t.h = h;
	}

	function bindTarget(t) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
	}

	function bindScreen() {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	function drawQuad() {
		gl.bindVertexArray(vao);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindVertexArray(null);
	}

	function setScissor(x, y, w, h) {
		if (w == null) {
			gl.disable(gl.SCISSOR_TEST);
		} else {
			gl.enable(gl.SCISSOR_TEST);
			gl.scissor(x, y, w, h);
		}
	}

	return {
		gl, createProgram, createTexture, upload, uploadData, bind, frame, drawQuad, setScissor,
		createTarget, resizeTarget, bindTarget, bindScreen,
	};
}
