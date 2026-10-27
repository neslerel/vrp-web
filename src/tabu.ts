import { ClarkeWright, Route, f1, type Instance, type Solver } from './model'
import type { Rng } from './rng'

export interface TabuRecord {
  iter: number
  move: string
  cost: number
  best: number
  newBest: boolean
  uphill: boolean
  note: string
}

interface Move {
  a: number // rutas afectadas
  b: number
  newA: number[] // nuevas secuencias
  newB: number[] | null
  moved: number[] // puntos que se mueven (se vuelven tabú)
  text: string
  delta: number
}

/**
 * Búsqueda tabú para el VRP con K rutas fijas. La capacidad se relaja con una penalización
 * (λ por unidad de exceso), de modo que la búsqueda puede atravesar soluciones no factibles.
 * Vecindario: reubicar un punto, intercambiar dos puntos de rutas distintas y 2-opt dentro de una ruta.
 * Lista tabú: un punto que se mueve queda prohibido durante «tenencia» iteraciones.
 */
export class TabuSearch implements Solver {
  static readonly LAMBDA = 10

  iter = 0
  routes: Route[] = []
  message = ''
  initialDistance = 0
  curCost = 0
  bestCost = 0
  records: TabuRecord[] = []
  histCur: number[] = []
  histBest: number[] = []
  tabuUntil: number[]

  private sol: number[][]
  private best: number[][]
  private hi: number[] = []
  private lastBest = false

  constructor(
    readonly p: Instance,
    readonly maxIter: number,
    readonly tenure: number,
    fromClarkeWright: boolean,
    rnd: Rng,
  ) {
    this.tabuUntil = new Array<number>(p.n + 1).fill(0)
    this.sol = Array.from({ length: p.k }, () => [])

    let origin: string
    if (fromClarkeWright) {
      const cw = new ClarkeWright(p)
      while (!cw.done) cw.step()
      const rs = [...cw.routes].sort((a, b) => b.load - a.load)
      for (let k = 0; k < Math.min(rs.length, p.k); k++) this.sol[k].push(...rs[k].nodes)
      for (let k = p.k; k < rs.length; k++) for (const c of rs[k].nodes) this.leastLoaded().push(c) // rutas sin vehículo: se reparten
      origin = 'la solución de Clarke & Wright' + (rs.length > p.k ? ` (${rs.length} rutas, repartidas en ${p.k} vehículos)` : '')
    } else {
      const order = Array.from({ length: p.n }, (_, i) => i + 1)
      for (let i = order.length - 1; i > 0; i--) {
        const j = rnd.int(0, i + 1)
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      for (const c of order) this.leastLoaded().push(c)
      origin = 'una solución aleatoria'
    }

    this.best = copy(this.sol)
    this.curCost = this.bestCost = this.cost(this.sol)
    this.initialDistance = this.totalDistance
    this.rebuild()
    this.message =
      `Iteración 0: se parte de ${origin}. Distancia = ${f1(this.totalDistance)}` +
      (this.currentFeasible
        ? ' (factible).'
        : `, pero hay exceso de carga (penalización ${TabuSearch.LAMBDA}/unidad): coste = ${f1(this.curCost)}.`) +
      '\nEn cada iteración se evalúan todos los movimientos vecinos y se aplica el mejor que no sea tabú, aunque empeore el coste.'
    this.histCur.push(this.curCost)
    this.histBest.push(this.bestCost)
  }

  get done() {
    return this.iter >= this.maxIter
  }
  get grayLonely() {
    return false
  }
  get steps() {
    return this.iter
  }
  get hiNodes(): number[] {
    return this.done ? [] : this.hi
  }
  get hiColor() {
    return this.lastBest ? '#009600' : '#e67800'
  }
  get hiLine() {
    return false
  }
  get totalDistance() {
    return this.sol.reduce((s, r) => s + this.routeDist(r), 0)
  }
  get bestDistance() {
    return this.best.reduce((s, r) => s + this.routeDist(r), 0)
  }
  get bestFeasible() {
    return this.best.every((r) => this.load(r) <= this.p.q)
  }
  get currentFeasible() {
    return this.sol.every((r) => this.load(r) <= this.p.q)
  }

  private leastLoaded(): number[] {
    let best = this.sol[0]
    let bl = this.load(best)
    for (const r of this.sol) {
      const l = this.load(r)
      if (l < bl) {
        best = r
        bl = l
      }
    }
    return best
  }
  private load(r: number[]) {
    let s = 0
    for (const c of r) s += this.p.demand[c]
    return s
  }
  private routeDist(r: number[]) {
    if (r.length === 0) return 0
    const d = this.p.d
    let s = d[0][r[0]] + d[r[r.length - 1]][0]
    for (let i = 0; i + 1 < r.length; i++) s += d[r[i]][r[i + 1]]
    return s
  }
  private routeCost(r: number[]) {
    return this.routeDist(r) + TabuSearch.LAMBDA * Math.max(0, this.load(r) - this.p.q)
  }
  private cost(s: number[][]) {
    return s.reduce((t, r) => t + this.routeCost(r), 0)
  }

  private rebuild() {
    this.routes = []
    this.sol.forEach((nodes, k) => {
      if (nodes.length === 0) return
      const r = new Route(k + 1)
      r.vehicle = k + 1
      r.nodes = [...nodes]
      r.load = this.load(nodes)
      this.routes.push(r)
    })
  }

  step(): boolean {
    if (this.done) return false
    this.iter++
    const sol = this.sol
    const rc = sol.map((r) => this.routeCost(r))
    let bestMove: Move | null = null
    let bestTabu: Move | null = null
    let aspirated = false

    const consider = (m: Move) => {
      m.delta = this.routeCost(m.newA) + (m.newB ? this.routeCost(m.newB) : 0) - rc[m.a] - (m.newB ? rc[m.b] : 0)
      if (Math.abs(m.delta) < 1e-9) return // movimiento que no cambia nada (p. ej. invertir una ruta simétrica)
      const tabu = m.moved.some((c) => this.tabuUntil[c] >= this.iter)
      const aspiration = tabu && this.curCost + m.delta < this.bestCost - 1e-9
      if (tabu && !aspiration) {
        if (bestTabu === null || m.delta < bestTabu.delta) bestTabu = m
        return
      }
      if (bestMove === null || m.delta < bestMove.delta - 1e-12) {
        bestMove = m
        aspirated = aspiration
      }
    }

    for (let a = 0; a < sol.length; a++) {
      const ra = sol[a]
      // Reubicar un punto (en otra ruta o en otra posición de la misma)
      for (let i = 0; i < ra.length; i++) {
        const c = ra[i]
        const withoutC = [...ra]
        withoutC.splice(i, 1)
        for (let b = 0; b < sol.length; b++) {
          if (b === a) {
            for (let pos = 0; pos <= withoutC.length; pos++) {
              if (pos === i) continue
              const na = [...withoutC]
              na.splice(pos, 0, c)
              consider({ a, b: -1, newA: na, newB: null, moved: [c], text: `Reubicar ${c} dentro de R${a + 1} (posición ${pos + 1})`, delta: 0 })
            }
          } else {
            for (let pos = 0; pos <= sol[b].length; pos++) {
              const nb = [...sol[b]]
              nb.splice(pos, 0, c)
              consider({ a, b, newA: withoutC, newB: nb, moved: [c], text: `Mover ${c}: R${a + 1} → R${b + 1} (posición ${pos + 1})`, delta: 0 })
            }
          }
        }
      }
      // 2-opt dentro de la ruta
      for (let i = 0; i < ra.length - 1; i++)
        for (let j = i + 1; j < ra.length; j++) {
          const na = [...ra]
          reverseRange(na, i, j)
          consider({ a, b: -1, newA: na, newB: null, moved: [ra[i], ra[j]], text: `2-opt en R${a + 1}: invertir ${ra[i]}…${ra[j]}`, delta: 0 })
        }
      // Intercambio entre rutas
      for (let b = a + 1; b < sol.length; b++)
        for (let i = 0; i < ra.length; i++)
          for (let j = 0; j < sol[b].length; j++) {
            const na = [...ra]
            const nb = [...sol[b]]
            na[i] = sol[b][j]
            nb[j] = ra[i]
            consider({ a, b, newA: na, newB: nb, moved: [ra[i], sol[b][j]], text: `Intercambiar ${ra[i]} (R${a + 1}) ↔ ${sol[b][j]} (R${b + 1})`, delta: 0 })
          }
    }

    let forced = false
    let mv = bestMove as Move | null
    if (mv === null) {
      mv = bestTabu as Move | null
      forced = true
    }
    if (mv === null) {
      // Sin vecinos (p. ej. un único punto): no hay nada que explorar
      this.iter = this.maxIter
      this.message = 'No hay movimientos posibles.'
      return true
    }

    const prev = this.curCost
    sol[mv.a] = mv.newA
    if (mv.newB) sol[mv.b] = mv.newB
    this.curCost += mv.delta
    for (const c of mv.moved) this.tabuUntil[c] = this.iter + this.tenure
    this.hi = [...mv.moved]

    this.lastBest = this.curCost < this.bestCost - 1e-9
    if (this.lastBest) {
      this.bestCost = this.curCost
      this.best = copy(sol)
    }

    const uphill = this.curCost > prev + 1e-9
    const note = this.lastBest
      ? '★ nueva mejor'
      : aspirated
        ? 'aspiración (tabú pero mejora el récord)'
        : forced
          ? 'todos tabú: se fuerza'
          : uphill
            ? 'empeora (escapa del óptimo local)'
            : ''
    this.records.push({ iter: this.iter, move: mv.text, cost: this.curCost, best: this.bestCost, newBest: this.lastBest, uphill, note })
    this.histCur.push(this.curCost)
    this.histBest.push(this.bestCost)

    const tabuList = Array.from({ length: this.p.n }, (_, i) => i + 1)
      .filter((c) => this.tabuUntil[c] >= this.iter + 1)
      .sort((a, b) => this.tabuUntil[a] - this.tabuUntil[b])
      .map((c) => `${c}(hasta it. ${this.tabuUntil[c]})`)
      .join(', ')
    this.message =
      `Iteración ${this.iter}/${this.maxIter}: ${mv.text}.  Coste ${f1(prev)} → ${f1(this.curCost)} (${note === '' ? 'mejora' : note}).  Mejor = ${f1(this.bestCost)}.\n` +
      `Lista tabú (puntos que no se pueden mover): ${tabuList === '' ? 'vacía' : tabuList}`

    if (this.done) this.finish()
    else this.rebuild()
    return true
  }

  private finish() {
    this.sol = copy(this.best)
    this.curCost = this.bestCost
    this.rebuild()
    const over = this.routes.filter((r) => r.load > this.p.q).length
    this.message +=
      `\nFIN tras ${this.maxIter} iteraciones. Se devuelve la mejor solución encontrada: distancia = ${f1(this.totalDistance)} ` +
      `(inicial ${f1(this.initialDistance)}). ` +
      (over === 0
        ? `Solución FACTIBLE con ${this.routes.length} rutas ≤ ${this.p.k} vehículos.`
        : `Sigue habiendo ${over} ruta(s) con exceso de carga: prueba con más iteraciones, otra tenencia o más capacidad.`)
  }
}

const copy = (s: number[][]) => s.map((r) => [...r])

/** Invierte a[i..j] (ambos incluidos). */
function reverseRange(a: number[], i: number, j: number) {
  while (i < j) {
    ;[a[i], a[j]] = [a[j], a[i]]
    i++
    j--
  }
}
