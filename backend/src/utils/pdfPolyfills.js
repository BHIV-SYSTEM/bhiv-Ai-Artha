/**
 * Browser-API polyfills required by pdf.js when running under Node.js.
 *
 * pdfjs-dist (and pdf-parse, which wraps it) reference DOMMatrix / Path2D /
 * ImageData from the browser when building their render state. No Node
 * version provides these globals, so on some documents and runtimes the
 * extraction throws "DOMMatrix is not defined" — in production this surfaced
 * as "PDF read failed: DOMMatrix is not defined" for every uploaded PDF.
 *
 * Real, spec-correct implementations are loaded synchronously from
 * @napi-rs/canvas (a hard dependency, no native build tools needed).
 * If that import somehow fails, minimal identity stubs are installed so
 * text extraction — which only needs the globals to exist — still works.
 *
 * Import this module BEFORE any pdfjs / pdf-parse import.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (typeof globalThis.DOMMatrix === 'undefined') {
  try {
    const canvas = require('@napi-rs/canvas');
    if (canvas.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
    if (canvas.Path2D) globalThis.Path2D = canvas.Path2D;
    if (canvas.ImageData) globalThis.ImageData = canvas.ImageData;
  } catch {
    // Canvas bindings unavailable — fall through to the stubs below.
  }
}

if (typeof globalThis.DOMMatrix === 'undefined') {
  class StubDOMMatrix {
    constructor(init) {
      const v = init == null ? [] : Array.from(init);
      if (v.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = v;
      } else if (v.length >= 16) {
        this.a = v[0]; this.b = v[1]; this.c = v[4];
        this.d = v[5]; this.e = v[12]; this.f = v[13];
      } else if (v.length === 0) {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      } else {
        throw new TypeError('Invalid DOMMatrix initializer');
      }
      this.m11 = this.a; this.m12 = this.b; this.m13 = 0; this.m14 = 0;
      this.m21 = this.c; this.m22 = this.d; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = this.e; this.m42 = this.f; this.m43 = 0; this.m44 = 1;
    }

    static fromMatrix(init = {}) {
      if (init.a != null) return new StubDOMMatrix([init.a, init.b, init.c, init.d, init.e, init.f]);
      if (init.m11 != null) {
        return new StubDOMMatrix([init.m11, init.m12, init.m21, init.m22, init.m41, init.m42]);
      }
      return new StubDOMMatrix();
    }

    multiplySelf(o) {
      const { a, b, c, d, e, f } = this;
      this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b;
      this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d;
      this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f;
      return this._sync();
    }

    preMultiplySelf(o) {
      const m = new StubDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
      this.a = o.a; this.b = o.b; this.c = o.c; this.d = o.d; this.e = o.e; this.f = o.f;
      return this.multiplySelf(m);
    }

    translateSelf(x = 0, y = 0) {
      return this.multiplySelf(new StubDOMMatrix([1, 0, 0, 1, x, y]));
    }

    scaleSelf(x = 1, y = x) {
      return this.multiplySelf(new StubDOMMatrix([x, 0, 0, y, 0, 0]));
    }

    rotateSelf(deg = 0) {
      const r = (deg * Math.PI) / 180;
      return this.multiplySelf(new StubDOMMatrix([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]));
    }

    invertSelf() {
      const { a, b, c, d, e, f } = this;
      const det = a * d - b * c;
      if (!det) return this;
      const id = 1 / det;
      this.a = d * id; this.b = -b * id; this.c = -c * id; this.d = a * id;
      this.e = (c * f - d * e) * id; this.f = (b * e - a * f) * id;
      return this._sync();
    }

    transformPoint(x = 0, y = 0) {
      return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
    }

    toFloat32Array() {
      return new Float32Array([
        this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1,
      ]);
    }

    _sync() {
      this.m11 = this.a; this.m12 = this.b; this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
      return this;
    }
  }

  globalThis.DOMMatrix = StubDOMMatrix;
}

if (typeof globalThis.Path2D === 'undefined') {
  try {
    const canvas = require('@napi-rs/canvas');
    if (canvas.Path2D) globalThis.Path2D = canvas.Path2D;
  } catch { /* ignore */ }
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class StubPath2D {
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
  };
}

if (typeof globalThis.ImageData === 'undefined') {
  try {
    const canvas = require('@napi-rs/canvas');
    if (canvas.ImageData) globalThis.ImageData = canvas.ImageData;
  } catch { /* ignore */ }
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class StubImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}
