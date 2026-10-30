import { useEffect, useRef, useState } from 'react'
import { compact, money } from './kit'

// Gráficos do Dunna em SVG puro: barras finas com ponta arredondada, grade discreta, legenda e
// tooltip ao passar o mouse. Cores validadas para daltonismo: série única em índigo; pares em azul/laranja.
const H = 230, PAD = { l: 58, r: 8, t: 14, b: 28 }
const ticks = (max: number) => { if (max <= 0) return [0]; const step = Math.pow(10, Math.floor(Math.log10(max))); const nice = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => max / s <= 5) || step * 10; return Array.from({ length: Math.ceil(max / nice) + 1 }, (_, i) => i * nice) }
// Barra com topo arredondado (4px) e base reta no eixo
const bar = (x: number, y: number, w: number, h: number) => { const r = Math.min(4, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z` }

type Tip = { x: number; y: number; title: string; lines: string[] } | null
// O SVG usa a largura real do card: texto do eixo com tamanho constante em qualquer coluna
function useWidth() {
 const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(560)
 useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width)))); ro.observe(el); return () => ro.disconnect() })
 return [ref, width] as const
}
function Tooltip({ tip, W }: { tip: Tip; W: number }) { return tip ? <div className="dn-tip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}><strong>{tip.title}</strong>{tip.lines.map(l => <span key={l}>{l}</span>)}</div> : null }

export function BarPair({ rows, labels, empty, format = money }: { rows: { label: string; a: number; b: number; projected?: boolean }[]; labels: [string, string]; empty: string; format?: (c: number) => string }) {
 const [tip, setTip] = useState<Tip>(null), [box, W] = useWidth()
 if (!rows.length || rows.every(r => !r.a && !r.b)) return <p className="dn-muted">{empty}</p>
 const max = Math.max(...rows.map(r => Math.max(r.a, r.b))), t = ticks(max), top = t[t.length - 1] || 1
 const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, slot = iw / rows.length, bw = Math.max(3, Math.min(18, slot / 3 - 2))
 const y = (v: number) => PAD.t + ih - (v / top) * ih
 const every = Math.ceil(rows.length / Math.max(3, Math.floor(iw / 62)))
 return <figure className="dn-chart"><div className="dn-legend"><span><i className="s-a" />{labels[0]}</span><span><i className="s-b" />{labels[1]}</span>{rows.some(r => r.projected) && <span><i className="s-proj" />Período só com previsão</span>}</div>
  <div className="dn-chart-box" ref={box}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels[0]} e ${labels[1]} por período`} onMouseLeave={() => setTip(null)}>
   {t.map(v => <g key={v}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="dn-grid" /><text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="dn-axis">{compact(v)}</text></g>)}
   {rows.map((r, i) => { const cx = PAD.l + slot * i + slot / 2; return <g key={i} className={r.projected ? 'dn-projected' : ''}>
    {r.a > 0 && <path d={bar(cx - bw - 1, y(r.a), bw, PAD.t + ih - y(r.a))} className="s-a" />}
    {r.b > 0 && <path d={bar(cx + 1, y(r.b), bw, PAD.t + ih - y(r.b))} className="s-b" />}
    {i % every === 0 && <text x={cx} y={H - 10} textAnchor="middle" className="dn-axis">{r.label}</text>}
    <rect x={cx - slot / 2} y={PAD.t} width={slot} height={ih} fill="transparent" onMouseEnter={() => setTip({ x: cx, y: Math.min(y(Math.max(r.a, r.b)), PAD.t + ih - 40), title: r.label, lines: [`${labels[0]}: ${format(r.a)}`, `${labels[1]}: ${format(r.b)}`, `Diferença: ${format(r.a - r.b)}`] })} />
   </g> })}
   <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="dn-baseline" />
  </svg><Tooltip tip={tip} W={W} /></div></figure>
}

export function Bars({ rows, label, empty, format = money, signed = false }: { rows: { label: string; value: number; note?: string }[]; label: string; empty: string; format?: (c: number) => string; signed?: boolean }) {
 const [tip, setTip] = useState<Tip>(null), [box, W] = useWidth()
 if (!rows.length || rows.every(r => !r.value)) return <p className="dn-muted">{empty}</p>
 const max = Math.max(0, ...rows.map(r => r.value)), min = signed ? Math.min(0, ...rows.map(r => r.value)) : 0
 const t = ticks(Math.max(max, -min)), top = t[t.length - 1] || 1, span = min < 0 ? top * 2 : top
 const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, slot = iw / rows.length, bw = Math.max(4, Math.min(26, slot * 0.55))
 const zero = min < 0 ? PAD.t + ih / 2 : PAD.t + ih, y = (v: number) => zero - (v / span) * ih
 const gridValues = min < 0 ? [...t.slice(1).map(v => -v).reverse(), ...t] : t
 return <figure className="dn-chart"><div className="dn-legend"><span><i className="s-one" />{label}</span></div><div className="dn-chart-box" ref={box}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setTip(null)}>
  {gridValues.map(v => <g key={v}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="dn-grid" /><text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="dn-axis">{compact(v)}</text></g>)}
  {rows.map((r, i) => { const cx = PAD.l + slot * i + slot / 2, h = Math.abs(y(r.value) - zero); return <g key={i}>
   {r.value !== 0 && (r.value > 0 ? <path d={bar(cx - bw / 2, y(r.value), bw, h)} className="s-one" /> : <path d={bar(cx - bw / 2, zero, bw, h)} transform={`rotate(180 ${cx} ${zero + h / 2})`} className="s-neg" />)}
   {i % Math.ceil(rows.length / Math.max(3, Math.floor(iw / 62))) === 0 && <text x={cx} y={H - 10} textAnchor="middle" className="dn-axis">{r.label}</text>}
   <rect x={cx - slot / 2} y={PAD.t} width={slot} height={ih} fill="transparent" onMouseEnter={() => setTip({ x: cx, y: Math.min(y(Math.max(r.value, 0)), PAD.t + ih - 40), title: r.label, lines: [format(r.value), ...(r.note ? [r.note] : [])] })} />
  </g> })}
  <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} className="dn-baseline" />
 </svg><Tooltip tip={tip} W={W} /></div></figure>
}

/** Funil horizontal: cada etapa como barra proporcional à primeira, com a taxa de passagem. */
export function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
 const first = steps[0]?.count || 0
 if (!first) return <p className="dn-muted">Nenhum interessado chegou neste período.</p>
 return <ol className="dn-funnel">{steps.map((s, i) => { const prev = i ? steps[i - 1].count : s.count; return <li key={s.label}><span>{s.label}</span><div className="dn-hbar"><i style={{ width: `${Math.max(1.5, (s.count / first) * 100)}%` }} /></div><b>{s.count}</b><small>{i ? (prev ? `${Math.round((s.count / prev) * 100)}% da etapa anterior` : '—') : '100%'}</small></li> })}</ol>
}
