/** Generador pseudoaleatorio con semilla (mulberry32): misma semilla, mismo problema. */
export interface Rng {
  /** Real en [0, 1). */
  next(): number
  /** Entero en [min, maxExclusive). */
  int(min: number, maxExclusive: number): number
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (min, maxExclusive) => min + Math.floor(next() * (maxExclusive - min)) }
}

/** Semilla aleatoria entre 1 y 999999 (el 0 se reserva para «al azar»). */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999999)
}
