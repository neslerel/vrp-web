import { describe, expect, it } from 'vitest'
import { ClarkeWright, generateInstance, maxTotalDemand, type Instance } from './model'
import { createRng } from './rng'
import { TabuSearch } from './tabu'

function smallInstance(): Instance {
  // Central en (0,0); tres puntos alineados sobre el eje x y uno lejos en y. Demandas conocidas.
  const x = [0, 10, 20, 30, 0]
  const y = [0, 0, 0, 0, 50]
  const demand = [0, 4, 4, 4, 6]
  const d = x.map((_, i) => x.map((_, j) => Math.hypot(x[i] - x[j], y[i] - y[j])))
  return { n: 4, k: 2, q: 12, x, y, demand, d, totalDemand: 18 }
}

describe('generateInstance', () => {
  it('es determinista con la misma semilla', () => {
    const a = generateInstance(15, 4, 100, createRng(7))
    const b = generateInstance(15, 4, 100, createRng(7))
    expect(a.x).toEqual(b.x)
    expect(a.demand).toEqual(b.demand)
  })

  it('respeta los límites de demanda y de coordenadas', () => {
    for (const [n, k, q] of [[15, 4, 100], [2, 1, 5], [60, 20, 2000], [30, 3, 50]]) {
      const p = generateInstance(n, k, q, createRng(n * 31 + k))
      const total = p.demand.slice(1).reduce((s, v) => s + v, 0)
      expect(total).toBe(p.totalDemand)
      expect(total).toBeLessThanOrEqual(maxTotalDemand(k, q))
      for (let i = 1; i <= n; i++) {
        expect(p.demand[i]).toBeGreaterThanOrEqual(1)
        expect(p.demand[i]).toBeLessThanOrEqual(q)
        expect(p.x[i]).toBeGreaterThanOrEqual(2)
        expect(p.x[i]).toBeLessThanOrEqual(98)
      }
    }
  })

  it('rechaza un problema sin sentido', () => {
    expect(() => generateInstance(50, 1, 10, createRng(1))).toThrow()
  })
})

describe('ClarkeWright', () => {
  it('calcula y ordena los ahorros de una instancia conocida', () => {
    const cw = new ClarkeWright(smallInstance())
    expect(cw.savings.length).toBe(6)
    // s(2,3) = 20 + 30 − 10 = 40 es el mayor; s(1,3) = 10 + 30 − 20 = 20 el siguiente entre los puntos del eje
    expect(cw.savings[0]).toMatchObject({ i: 2, j: 3, value: 40 })
    const values = cw.savings.map((s) => s.value)
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })

  it('fusiona respetando la capacidad (4 + 4 + 4 > 12 no cabe en una sola ruta con el punto 4)', () => {
    const cw = new ClarkeWright(smallInstance())
    while (!cw.done) cw.step()
    for (const r of cw.routes) expect(r.load).toBeLessThanOrEqual(12)
    const visited = cw.routes.flatMap((r) => r.nodes).sort()
    expect(visited).toEqual([1, 2, 3, 4])
    expect(cw.totalDistance).toBeLessThan(cw.initialDistance)
  })

  it('en instancias aleatorias visita cada punto una vez, no excede Q y nunca empeora la distancia', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const p = generateInstance(5 + (seed % 40), 2 + (seed % 6), 80 + seed, createRng(seed))
      const cw = new ClarkeWright(p)
      let last = cw.totalDistance
      while (!cw.done) {
        cw.step()
        expect(cw.totalDistance).toBeLessThanOrEqual(last + 1e-9)
        last = cw.totalDistance
      }
      const visited = cw.routes.flatMap((r) => r.nodes).sort((a, b) => a - b)
      expect(visited).toEqual(Array.from({ length: p.n }, (_, i) => i + 1))
      for (const r of cw.routes) expect(r.load).toBeLessThanOrEqual(p.q)
      expect(cw.savings.every((s) => s.status !== 'pending')).toBe(true)
    }
  })

  it('con un único punto no hay nada que fusionar', () => {
    const p = generateInstance(2, 1, 50, createRng(3))
    const one: Instance = { ...p, n: 1, x: p.x.slice(0, 2), y: p.y.slice(0, 2), demand: p.demand.slice(0, 2), d: [p.d[0].slice(0, 2), p.d[1].slice(0, 2)] }
    const cw = new ClarkeWright(one)
    expect(cw.done).toBe(true)
    expect(cw.message).toContain('único punto')
  })
})

describe('TabuSearch', () => {
  it('conserva todos los puntos y el mejor coste no empeora', () => {
    for (const fromCw of [true, false]) {
      const p = generateInstance(20, 4, 100, createRng(11))
      const t = new TabuSearch(p, 60, 7, fromCw, createRng(12))
      let prevBest = t.bestCost
      while (!t.done) {
        t.step()
        expect(t.bestCost).toBeLessThanOrEqual(prevBest + 1e-9)
        prevBest = t.bestCost
      }
      const visited = t.routes.flatMap((r) => r.nodes).sort((a, b) => a - b)
      expect(visited).toEqual(Array.from({ length: p.n }, (_, i) => i + 1))
      expect(t.records.length).toBe(60)
      expect(t.histCur.length).toBe(61)
    }
  })

  it('mejora o iguala la solución de partida de Clarke & Wright', () => {
    const p = generateInstance(25, 5, 100, createRng(5))
    const cw = new ClarkeWright(p)
    while (!cw.done) cw.step()
    const t = new TabuSearch(p, 80, 7, true, createRng(6))
    while (!t.done) t.step()
    expect(t.bestCost).toBeLessThanOrEqual(t.records.length ? t.histBest[0] + 1e-9 : Infinity)
    if (cw.routes.length <= p.k) expect(t.bestDistance).toBeLessThanOrEqual(cw.totalDistance + 1e-9)
  })

  it('el coste acumulado coincide con el recalculado desde cero', () => {
    const p = generateInstance(18, 3, 90, createRng(21))
    const t = new TabuSearch(p, 40, 5, false, createRng(22))
    for (let i = 0; i < 39; i++) {
      t.step()
      const recomputed = t.routes.reduce((s, r) => s + r.distance(p) + 10 * Math.max(0, r.load - p.q), 0)
      expect(t.curCost).toBeCloseTo(recomputed, 6)
    }
  })

  it('tarda poco en el caso más grande permitido', () => {
    const p = generateInstance(60, 20, 2000, createRng(9))
    const t = new TabuSearch(p, 10, 7, true, createRng(10))
    const t0 = performance.now()
    while (!t.done) t.step()
    const msPerIter = (performance.now() - t0) / 10
    console.log(`60 puntos, 20 vehículos: ${msPerIter.toFixed(1)} ms por iteración`)
    expect(msPerIter).toBeLessThan(500)
  })
})
