export function hashSeed(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function random(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const mix = t => t * t * (3 - 2 * t);
function lattice(x, y, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const tx = mix(x - ix), ty = mix(y - iy), tz = mix(z - iz);
  let sum = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    sum += lattice(ix + dx, iy + dy, iz + dz, seed) * (dx ? tx : 1-tx) * (dy ? ty : 1-ty) * (dz ? tz : 1-tz);
  }
  return sum;
}
export function fbm(x, y, z, seed, scale = 2.5, octaves = 4) {
  let result = 0, total = 0, amplitude = 1;
  for (let k = 0; k < octaves; k++) {
    result += amplitude * noise3(x * scale + 11, y * scale + 19, z * scale + 31, seed + k * 7919);
    total += amplitude; amplitude *= 0.5; scale *= 2;
  }
  return result / total;
}
