import { type Route, type Solver } from './model'
import type { TabuSearch } from './tabu'

export const PALETTE = [
  '#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#17becf',
  '#bc8014', '#e377c2', '#5a5a5a', '#008080', '#800040', '#64a000',
]
export const colorOf = (r: Route) => PALETTE[r.id % PALETTE.length]

const STRIP_H = 96
const PAD = 28
const FONT = "'Segoe UI', system-ui, sans-serif"

/** Ajusta el canvas a su tamaño CSS y a la densidad de píxeles; devuelve el contexto y el tamaño lógico. */
export function prepareCanvas(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(cv.clientWidth))
  const h = Math.max(1, Math.round(cv.clientHeight))
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
  }
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { ctx, w, h }
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, bold = false, align: CanvasTextAlign = 'left') {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}

function line(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string, width: number, dash: number[] = []) {
  ctx.beginPath()
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.setLineDash([])
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, stroke: string | null, lw: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.stroke()
  }
}

/** Dibuja la central, los puntos de entrega, las rutas y la flota de vehículos. */
export function drawMap(cv: HTMLCanvasElement, eng: Solver | null) {
  const { ctx, w, h } = prepareCanvas(cv)
  if (!eng) return
  const p = eng.p

  const mr = { x: PAD, y: PAD, w: Math.max(10, w - 2 * PAD), h: Math.max(10, h - STRIP_H - 2 * PAD) }
  const s = Math.min(mr.w, mr.h) / 100
  const ox = mr.x + (mr.w - 100 * s) / 2
  const oy = mr.y + (mr.h - 100 * s) / 2
  const at = (i: number) => ({ x: ox + p.x[i] * s, y: oy + (100 - p.y[i]) * s })

  // Marco y cuadrícula
  ctx.lineWidth = 1
  ctx.strokeStyle = '#ebebeb'
  for (let k = 0; k <= 100; k += 10) {
    ctx.beginPath()
    ctx.moveTo(ox + k * s, oy)
    ctx.lineTo(ox + k * s, oy + 100 * s)
    ctx.moveTo(ox, oy + k * s)
    ctx.lineTo(ox + 100 * s, oy + k * s)
    ctx.stroke()
  }
  ctx.strokeStyle = '#c0c0c0'
  ctx.strokeRect(ox, oy, 100 * s, 100 * s)

  // Rutas
  for (const r of eng.routes) {
    const single = eng.grayLonely && r.nodes.length === 1
    const col = single ? '#c8c8c8' : colorOf(r)
    const pts = [at(0), ...r.nodes.map(at), at(0)]
    line(ctx, pts, col, single ? 1.2 : 3)
    if (!single) for (let k = 0; k + 1 < pts.length; k++) drawArrow(ctx, pts[k], pts[k + 1], col)
  }

  // Candidato actual
  if (eng.hiNodes.length > 0 && !eng.done) {
    const c = eng.hiColor
    const pts = eng.hiNodes.map(at)
    if (eng.hiLine && pts.length === 2) {
      line(ctx, pts, c, 2.5, [6, 4])
      text(ctx, '✘', (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, 18, c, true, 'center')
    }
    for (const q of pts) circle(ctx, q.x, q.y, 14, null, c, 3)
  }

  // Puntos de entrega
  const routeColor = new Map<number, string>()
  for (const r of eng.routes) for (const c of r.nodes) routeColor.set(c, eng.grayLonely && r.nodes.length === 1 ? '#808080' : colorOf(r))
  for (let i = 1; i <= p.n; i++) {
    const pt = at(i)
    circle(ctx, pt.x, pt.y, 11, '#ffffff', routeColor.get(i) ?? '#808080', 2.5)
    text(ctx, String(i), pt.x, pt.y + 0.5, 11.5, '#000', true, 'center')
    text(ctx, 'd=' + p.demand[i], pt.x, pt.y + 19, 10, '#696969', false, 'center')
  }

  // Central
  const c0 = at(0)
  ctx.fillStyle = '#000'
  ctx.fillRect(c0.x - 11, c0.y - 11, 22, 22)
  text(ctx, '0', c0.x, c0.y + 0.5, 12, '#fff', true, 'center')
  text(ctx, 'CENTRAL', c0.x, c0.y + 20, 10.5, '#000', true, 'center')

  // Camiones sobre el mapa al terminar
  if (eng.done)
    for (const r of eng.routes.filter((r) => r.vehicle > 0)) {
      const a = at(0)
      const b = at(r.first)
      drawTruck(ctx, a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4 - 14, 30, colorOf(r), r.load / p.q)
    }

  drawFleet(ctx, w, h, eng)
}

function drawArrow(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, col: string) {
  let dx = b.x - a.x
  let dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 40) return
  dx /= len
  dy /= len
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  ctx.beginPath()
  ctx.moveTo(m.x + dx * 6, m.y + dy * 6)
  ctx.lineTo(m.x - dx * 5 - dy * 5, m.y - dy * 5 + dx * 5)
  ctx.lineTo(m.x - dx * 5 + dy * 5, m.y - dy * 5 - dx * 5)
  ctx.closePath()
  ctx.fillStyle = col
  ctx.fill()
}

/** Camión con la caja llena en proporción a la carga. */
function drawTruck(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, col: string, load: number) {
  const h = w * 0.5
  const x = cx - w / 2
  const y = cy - h / 2
  const box = w * 0.68
  load = Math.max(0, Math.min(1, load))
  ctx.fillStyle = '#ebebeb'
  ctx.fillRect(x, y, box, h)
  ctx.globalAlpha = 0.78
  ctx.fillStyle = col
  ctx.fillRect(x, y + h * (1 - load), box, h * load)
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1.2
  ctx.strokeRect(x, y, box, h)
  ctx.beginPath()
  ctx.moveTo(x + box, y + h * 0.25)
  ctx.lineTo(x + w * 0.9, y + h * 0.25)
  ctx.lineTo(x + w, y + h * 0.55)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + box, y + h)
  ctx.closePath()
  ctx.fillStyle = col
  ctx.fill()
  ctx.stroke()
  const rw = Math.max(3, w * 0.13)
  ctx.fillStyle = '#000'
  for (const wx of [x + box * 0.22, x + box * 0.72, x + w * 0.85]) circle(ctx, wx, y + h, rw / 2, '#000', null, 0)
}

function drawFleet(ctx: CanvasRenderingContext2D, w: number, h: number, eng: Solver) {
  const p = eng.p
  const top = h - STRIP_H
  ctx.fillStyle = '#f8f8fa'
  ctx.fillRect(0, top + 1, w, STRIP_H)
  line(ctx, [{ x: 0, y: top }, { x: w, y: top }], '#c0c0c0', 1)

  const k = p.k
  const slot = Math.min(130, (w - 20) / k)
  const tw = Math.max(22, Math.min(56, slot * 0.7))
  const fs1 = slot >= 70 ? 11 : 9
  const fs2 = slot >= 70 ? 10.5 : 8.5
  const byVeh = new Map<number, Route>()
  for (const r of eng.routes) if (r.vehicle > 0) byVeh.set(r.vehicle, r)
  for (let v = 1; v <= k; v++) {
    const cx = 10 + slot * (v - 0.5)
    const r = byVeh.get(v)
    if (r) {
      drawTruck(ctx, cx, top + 30, tw, colorOf(r), r.load / p.q)
      text(ctx, `V${v}  ${r.load}/${p.q}`, cx, top + 56, fs1, r.load > p.q ? '#b22222' : '#000', true, 'center')
      if (slot >= 60) text(ctx, r.nodes.length === 1 ? `punto ${r.first}` : `${r.nodes.length} puntos`, cx, top + 72, fs2, '#696969', false, 'center')
    } else {
      drawTruck(ctx, cx, top + 30, tw, '#c0c0c0', 0)
      text(ctx, `V${v}  libre`, cx, top + 56, fs1, '#808080', true, 'center')
    }
  }

  const sinVeh = eng.routes.length - k
  text(ctx, `Flota: ${k} vehículos de capacidad ${p.q}   ·   Demanda total: ${p.totalDemand}   ·   Rutas actuales: ${eng.routes.length}`, 8, top + 10, 11, '#696969')
  if (sinVeh > 0) {
    const msg = eng.done ? `⚠ Faltan ${sinVeh} vehículo(s)` : `${sinVeh} ruta(s) sin vehículo por ahora`
    text(ctx, msg, w - 8, top + 10, 11, eng.done ? '#b22222' : '#ff8c00', true, 'right')
  }
}

/** Gráfica de convergencia: coste actual y mejor coste por iteración. */
export function drawChart(cv: HTMLCanvasElement, search: TabuSearch | null) {
  const { ctx, w, h } = prepareCanvas(cv)
  if (!search) return
  const cur = search.histCur
  const bst = search.histBest
  const plot = { x: 46, y: 8, w: w - 56, h: h - 28 }
  if (plot.w < 20 || plot.h < 20) return
  let min = Math.min(...cur, ...bst)
  let max = Math.max(...cur, ...bst)
  if (max - min < 1e-6) {
    max += 1
    min -= 1
  }
  const pad = (max - min) * 0.05
  min -= pad
  max += pad
  const n = Math.max(search.maxIter, 1)
  const pt = (i: number, v: number) => ({ x: plot.x + (i / n) * plot.w, y: plot.y + plot.h - ((v - min) / (max - min)) * plot.h })

  ctx.lineWidth = 1
  for (let k = 0; k <= 3; k++) {
    const y = plot.y + (plot.h * k) / 3
    ctx.strokeStyle = '#e6e6e6'
    ctx.beginPath()
    ctx.moveTo(plot.x, y)
    ctx.lineTo(plot.x + plot.w, y)
    ctx.stroke()
    text(ctx, (max - ((max - min) * k) / 3).toFixed(0), 2, y, 10.5, '#696969')
  }
  ctx.strokeStyle = '#c0c0c0'
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h)
  text(ctx, 'Iteración 0', plot.x, plot.y + plot.h + 11, 10.5, '#696969')
  text(ctx, String(n), plot.x + plot.w, plot.y + plot.h + 11, 10.5, '#696969', false, 'right')
  if (cur.length > 1) {
    line(ctx, cur.map((v, i) => pt(i, v)), 'rgba(31,119,180,0.6)', 1.5)
    line(ctx, bst.map((v, i) => pt(i, v)), '#d62728', 2.2)
  }
  text(ctx, '— coste actual', plot.x + 80, plot.y + plot.h + 11, 10.5, '#4682b4')
  text(ctx, '— mejor coste', plot.x + 170, plot.y + plot.h + 11, 10.5, '#b22222')
}
