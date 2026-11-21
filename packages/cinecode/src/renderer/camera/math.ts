// Lightweight 3D vector, matrix and quaternion math for camera rigs.

export const vec3 = {
  fromValues(x: number, y: number, z: number): Float32Array {
    return new Float32Array([x, y, z]);
  },
  length(v: ArrayLike<number>): number {
    return Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  },
  normalize(v: ArrayLike<number>): Float32Array {
    const len = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    const inv = len > 0.000001 ? 1 / len : 0;
    return new Float32Array([(v[0] ?? 0) * inv, (v[1] ?? 0) * inv, (v[2] ?? 0) * inv]);
  },
  subtract(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    return new Float32Array([(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)]);
  },
  cross(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    const az = a[2] ?? 0;
    const bx = b[0] ?? 0;
    const by = b[1] ?? 0;
    const bz = b[2] ?? 0;
    return new Float32Array([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
  },
  dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  },
};

export const quat = {
  fromValues(x: number, y: number, z: number, w: number): Float32Array {
    return new Float32Array([x, y, z, w]);
  },
  fromAxisAngle(axis: ArrayLike<number>, angleRad: number): Float32Array {
    const half = angleRad * 0.5;
    const s = Math.sin(half);
    const norm = vec3.normalize(axis);
    return new Float32Array([norm[0]! * s, norm[1]! * s, norm[2]! * s, Math.cos(half)]);
  },
  fromEuler(pitchRad: number, yawRad: number, rollRad: number, _order = "xyz"): Float32Array {
    const c1 = Math.cos(pitchRad * 0.5);
    const s1 = Math.sin(pitchRad * 0.5);
    const c2 = Math.cos(yawRad * 0.5);
    const s2 = Math.sin(yawRad * 0.5);
    const c3 = Math.cos(rollRad * 0.5);
    const s3 = Math.sin(rollRad * 0.5);
    return new Float32Array([
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    ]);
  },
  multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    const az = a[2] ?? 0;
    const aw = a[3] ?? 1;
    const bx = b[0] ?? 0;
    const by = b[1] ?? 0;
    const bz = b[2] ?? 0;
    const bw = b[3] ?? 1;
    return new Float32Array([
      ax * bw + aw * bx + ay * bz - az * by,
      ay * bw + aw * by + az * bx - ax * bz,
      az * bw + aw * bz + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz,
    ]);
  },
  slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
    let ax = a[0] ?? 0;
    let ay = a[1] ?? 0;
    let az = a[2] ?? 0;
    let aw = a[3] ?? 1;
    let bx = b[0] ?? 0;
    let by = b[1] ?? 0;
    let bz = b[2] ?? 0;
    let bw = b[3] ?? 1;
    let cosOmega = ax * bx + ay * by + az * bz + aw * bw;
    if (cosOmega < 0) {
      cosOmega = -cosOmega;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let scale0 = 1 - t;
    let scale1 = t;
    if (1 - cosOmega > 0.0001) {
      const omega = Math.acos(cosOmega);
      const sinOmega = Math.sin(omega);
      scale0 = Math.sin((1 - t) * omega) / sinOmega;
      scale1 = Math.sin(t * omega) / sinOmega;
    }
    return new Float32Array([
      scale0 * ax + scale1 * bx,
      scale0 * ay + scale1 * by,
      scale0 * az + scale1 * bz,
      scale0 * aw + scale1 * bw,
    ]);
  },
  fromMat(m: ArrayLike<number>): Float32Array {
    const m00 = m[0] ?? 0;
    const m01 = m[1] ?? 0;
    const m02 = m[2] ?? 0;
    const m10 = m[4] ?? 0;
    const m11 = m[5] ?? 0;
    const m12 = m[6] ?? 0;
    const m20 = m[8] ?? 0;
    const m21 = m[9] ?? 0;
    const m22 = m[10] ?? 0;
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      return new Float32Array([(m12 - m21) * s, (m20 - m02) * s, (m01 - m10) * s, 0.25 / s]);
    }
    if (m00 > m11 && m00 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
      return new Float32Array([0.25 * s, (m10 + m01) / s, (m20 + m02) / s, (m12 - m21) / s]);
    }
    if (m11 > m22) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
      return new Float32Array([(m10 + m01) / s, 0.25 * s, (m21 + m12) / s, (m20 - m02) / s]);
    }
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    return new Float32Array([(m20 + m02) / s, (m21 + m12) / s, 0.25 * s, (m01 - m10) / s]);
  },
};

export const mat4 = {
  identity(dst?: Float32Array): Float32Array {
    const out = dst ?? new Float32Array(16);
    out.fill(0);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  },
  set(
    m00: number, m01: number, m02: number, m03: number,
    m10: number, m11: number, m12: number, m13: number,
    m20: number, m21: number, m22: number, m23: number,
    m30: number, m31: number, m32: number, m33: number,
    dst?: Float32Array,
  ): Float32Array {
    const out = dst ?? new Float32Array(16);
    out[0] = m00; out[1] = m01; out[2] = m02; out[3] = m03;
    out[4] = m10; out[5] = m11; out[6] = m12; out[7] = m13;
    out[8] = m20; out[9] = m21; out[10] = m22; out[11] = m23;
    out[12] = m30; out[13] = m31; out[14] = m32; out[15] = m33;
    return out;
  },
  lookAt(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>, dst?: Float32Array): Float32Array {
    const out = dst ?? new Float32Array(16);
    const z = vec3.normalize(vec3.subtract(eye, target));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);

    out[0] = x[0]!; out[1] = y[0]!; out[2] = z[0]!; out[3] = 0;
    out[4] = x[1]!; out[5] = y[1]!; out[6] = z[1]!; out[7] = 0;
    out[8] = x[2]!; out[9] = y[2]!; out[10] = z[2]!; out[11] = 0;
    out[12] = -vec3.dot(x, eye);
    out[13] = -vec3.dot(y, eye);
    out[14] = -vec3.dot(z, eye);
    out[15] = 1;
    return out;
  },
  perspective(fovyRad: number, aspect: number, near: number, far: number, dst?: Float32Array): Float32Array {
    const out = dst ?? new Float32Array(16);
    const f = 1.0 / Math.tan(fovyRad / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },
  ortho(left: number, right: number, bottom: number, top: number, near: number, far: number, dst?: Float32Array): Float32Array {
    const out = dst ?? new Float32Array(16);
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = -2 * lr;
    out[5] = -2 * bt;
    out[10] = 2 * nf;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return out;
  },
  multiply(a: ArrayLike<number>, b: ArrayLike<number>, dst?: Float32Array): Float32Array {
    const out = dst ?? new Float32Array(16);
    const a00 = a[0] ?? 0; const a01 = a[1] ?? 0; const a02 = a[2] ?? 0; const a03 = a[3] ?? 0;
    const a10 = a[4] ?? 0; const a11 = a[5] ?? 0; const a12 = a[6] ?? 0; const a13 = a[7] ?? 0;
    const a20 = a[8] ?? 0; const a21 = a[9] ?? 0; const a22 = a[10] ?? 0; const a23 = a[11] ?? 0;
    const a30 = a[12] ?? 0; const a31 = a[13] ?? 0; const a32 = a[14] ?? 0; const a33 = a[15] ?? 0;

    let b0 = b[0] ?? 0; let b1 = b[1] ?? 0; let b2 = b[2] ?? 0; let b3 = b[3] ?? 0;
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4] ?? 0; b1 = b[5] ?? 0; b2 = b[6] ?? 0; b3 = b[7] ?? 0;
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8] ?? 0; b1 = b[9] ?? 0; b2 = b[10] ?? 0; b3 = b[11] ?? 0;
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12] ?? 0; b1 = b[13] ?? 0; b2 = b[14] ?? 0; b3 = b[15] ?? 0;
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  },
};
