import type { Rng } from './rng'

/** Un decimal con coma, como se escribe en español. */
export const f1 = (x: number) => x.toFixed(1).replace('.', ',')

/** Instancia del problema. Índice 0 = central; 1..N = puntos de entrega. */
export interface Instance {
  n: number
  k: number
  q: number
  x: number[]
  y: number[]
  demand: number[]
  d: number[][]
  totalDemand: number
}

/** Fracción máxima de la capacidad de la flota que puede sumar la demanda total, para que el problema tenga sentido. */
export const MAX_FILL = 0.8

export const maxTotalDemand = (k: number, q: number) => Math.floor(MAX_FILL * k * q)

export function generateInstance(n: number, k: number, q: number, rnd: Rng): Instance {
  const tmax = maxTotalDemand(k, q)
  if (n > tmax) throw new Error('Problema sin sentido: la demanda mínima no cabe en la flota')
  const x = new Array<number>(n + 1)
  const y = new Array<number>(n + 1)
  const demand = new Array<number>(n + 1).fill(0)
  x[0] = 15 + rnd.next() * 70
  y[0] = 15 + rnd.next() * 70
  for (let i = 1; i <= n; i++) {
    x[i] = 2 + rnd.next() * 96
    y[i] = 2 + rnd.next() * 96
  }

  // Demandas: ninguna supera la capacidad de un vehículo y la total cabe holgadamente en la flota.
  const target = 0.72 * k * q
  const dmax = Math.max(1, Math.min(q * 0.5, Math.floor((2 * target) / n)))
  let total = 0
  for (let i = 1; i <= n; i++) {
    demand[i] = rnd.int(1, Math.floor(dmax) + 1)
    total += demand[i]
  }
  while (total > tmax) {
    const i = rnd.int(1, n + 1)
    if (demand[i] > 1) {
      demand[i]--
      total--
    }
  }

  const d = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => Math.hypot(x[i] - x[j], y[i] - y[j])),
  )
  return { n, k, q, x, y, demand, d, totalDemand: total }
}

export class Route {
  nodes: number[] = []
  load = 0
  vehicle = 0 // 0 = sin vehículo asignado
  constructor(public id: number) {}
  get first() {
    return this.nodes[0]
  }
  get last() {
    return this.nodes[this.nodes.length - 1]
  }
  distance(p: Instance): number {
    let dist = p.d[0][this.first] + p.d[this.last][0]
    for (let i = 0; i + 1 < this.nodes.length; i++) dist += p.d[this.nodes[i]][this.nodes[i + 1]]
    return dist
  }
  text(): string {
    return '0 → ' + this.nodes.join(' → ') + ' → 0'
  }
}

export type SavingStatus = 'pending' | 'merged' | 'rejected'

export interface Saving {
  i: number
  j: number
  d0i: number
  d0j: number
  dij: number
  value: number
  status: SavingStatus
  reason: string
}

/** Lo que necesitan el mapa y las tablas para mostrar un algoritmo constructivo o de búsqueda. */
export interface Solver {
  readonly p: Instance
  readonly routes: Route[]
  readonly done: boolean
  /** Rutas de un solo punto en gris (solo Clarke & Wright). */
  readonly grayLonely: boolean
  /** Puntos resaltados en el último paso. */
  readonly hiNodes: number[]
  readonly hiColor: string
  /** Dibujar una línea discontinua entre los dos puntos resaltados. */
  readonly hiLine: boolean
  readonly message: string
  readonly initialDistance: number
  readonly totalDistance: number
  readonly steps: number
  step(): boolean
}

/** Algoritmo de los ahorros de Clarke & Wright (versión secuencial), ejecutable paso a paso. */
export class ClarkeWright implements Solver {
  routes: Route[] = []
  savings: Saving[] = []
  next = 0
  current: Saving | null = null
  merged = false // el último paso fusionó
  message = ''
  initialDistance = 0
  private routeOf: Route[]

  constructor(readonly p: Instance) {
    this.routeOf = new Array<Route>(p.n + 1)
    for (let i = 1; i <= p.n; i++) {
      const r = new Route(i)
      r.load = p.demand[i]
      r.nodes.push(i)
      this.routes.push(r)
      this.routeOf[i] = r
    }
    this.initialDistance = this.totalDistance

    for (let i = 1; i <= p.n; i++)
      for (let j = i + 1; j <= p.n; j++)
        this.savings.push({
          i,
          j,
          d0i: p.d[0][i],
          d0j: p.d[0][j],
          dij: p.d[i][j],
          value: p.d[0][i] + p.d[0][j] - p.d[i][j],
          status: 'pending',
          reason: '',
        })
    this.savings.sort((a, b) => b.value - a.value || a.i - b.i || a.j - b.j)

    this.assignVehicles()
    this.message =
      `Paso 0: cada punto de entrega tiene su propia ruta (0 → i → 0). Distancia total = ${f1(this.initialDistance)}. ` +
      `Se han calculado ${this.savings.length} ahorros s(i,j) = d(0,i) + d(0,j) − d(i,j), ordenados de mayor a menor.`
    if (this.done) this.message = 'Con un único punto de entrega no hay nada que fusionar.'
  }

  get done() {
    return this.next >= this.savings.length
  }
  get grayLonely() {
    return true
  }
  get steps() {
    return this.next
  }
  get hiNodes(): number[] {
    return this.current ? [this.current.i, this.current.j] : []
  }
  get hiColor() {
    return this.merged ? '#009600' : '#c80000'
  }
  get hiLine() {
    return this.current !== null && !this.merged
  }
  get totalDistance() {
    return this.routes.reduce((s, r) => s + r.distance(this.p), 0)
  }

  /** Las rutas más cargadas reciben los vehículos disponibles. */
  assignVehicles() {
    for (const r of this.routes) r.vehicle = 0
    let v = 1
    const order = [...this.routes].sort((a, b) => b.load - a.load || a.id - b.id)
    for (const r of order) {
      if (v > this.p.k) break
      r.vehicle = v++
    }
  }

  step(): boolean {
    if (this.done) return false
    const s = this.savings[this.next]
    this.next++
    this.current = s
    this.merged = false
    const ri = this.routeOf[s.i]
    const rj = this.routeOf[s.j]
    const head = `Ahorro nº ${this.next}: s(${s.i},${s.j}) = ${f1(s.d0i)} + ${f1(s.d0j)} − ${f1(s.dij)} = ${f1(s.value)}.  `

    if (ri === rj) this.reject(s, head, `los puntos ${s.i} y ${s.j} ya están en la misma ruta (cerraría un ciclo).`)
    else if (ri.first !== s.i && ri.last !== s.i)
      this.reject(s, head, `el punto ${s.i} no es extremo de su ruta (está en el interior).`)
    else if (rj.first !== s.j && rj.last !== s.j)
      this.reject(s, head, `el punto ${s.j} no es extremo de su ruta (está en el interior).`)
    else if (ri.load + rj.load > this.p.q)
      this.reject(s, head, `se supera la capacidad: ${ri.load} + ${rj.load} = ${ri.load + rj.load} > ${this.p.q}.`)
    else {
      if (ri.last !== s.i) ri.nodes.reverse()
      if (rj.first !== s.j) rj.nodes.reverse()
      ri.nodes.push(...rj.nodes)
      ri.load += rj.load
      for (const c of rj.nodes) this.routeOf[c] = ri
      this.routes.splice(this.routes.indexOf(rj), 1)
      s.status = 'merged'
      s.reason = `Fusiona R${ri.id} y R${rj.id}`
      this.merged = true
      this.message =
        head + `FUSIÓN ✔  Se unen las rutas (carga ${ri.load} ≤ ${this.p.q}). Se evita recorrer ${f1(s.value)} unidades de distancia.`
    }
    this.assignVehicles()

    if (this.done) {
      const extra = Math.max(0, this.routes.length - this.p.k)
      this.message +=
        '\nFIN: no quedan ahorros por examinar. ' +
        `Distancia total = ${f1(this.totalDistance)} (inicial ${f1(this.initialDistance)}, ahorro ${f1(this.initialDistance - this.totalDistance)}). ` +
        (extra === 0
          ? `Solución con ${this.routes.length} rutas ≤ ${this.p.k} vehículos: FACTIBLE.`
          : `Se obtienen ${this.routes.length} rutas pero solo hay ${this.p.k} vehículos: faltan ${extra} (aumenta flota o capacidad).`)
    }
    return true
  }

  private reject(s: Saving, head: string, why: string) {
    s.status = 'rejected'
    s.reason = why.replace(/\.$/, '')
    this.message = head + 'RECHAZADO ✘  ' + why
  }
}
