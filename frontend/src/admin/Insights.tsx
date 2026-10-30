import { useState } from 'react'
import { ArrowRight, Lightbulb, TrendingDown, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import type { Destination } from './Navigation'
import { Notice, Delta, money, moneyFull, dateBR, today, addDays, monthLabel, useResource } from './kit'
import { Bars, BarPair, Funnel } from './Charts'
import { STAGES } from './api'

type Summary = { count: number; revenueCents: number; avgTicketCents: number; cogsCents: number; commissionCents: number; marginCents: number; marginPct: number | null; pendingCost: number; avgDaysToSell: number | null }
type Line = { id: string; name: string; cents: number }
type Dre = { revenueCents: number; cogsCents: number; pendingCost: number; grossCents: number; commissionCents: number; otherIncome: Line[]; otherIncomeCents: number; opex: Line[]; opexCents: number; resultCents: number; resultPct: number | null }
type Mix = { key: string; stock: number; stockValueCents: number; sold: number; revenueCents: number; marginCents: number; marginPct: number | null; avgDaysToSell: number | null }
type Report = {
 from: string; to: string; previous: { from: string; to: string }
 sales: { current: Summary; previous: Summary; changes: { revenue: number | null; count: number | null; ticket: number | null; margin: number | null }; list: { dealId: string; closedAt: string; vehicleLabel: string; personName: string; sellerName: string; saleCents: number; costCents: number | null; marginCents: number | null; marginPct: number | null; daysToSell: number | null }[] }
 dre: { current: Dre; previous: Dre }
 series: { month: string; sales: number; revenueCents: number; marginCents: number; marginPct: number | null; opexCents: number; resultCents: number; cashInCents: number; cashOutCents: number }[]
 stock: { count: number; drafts: number; valueCents: number; costCents: number; missingCost: number; potentialMarginCents: number; potentialMarginPct: number | null; avgDays: number; holdingCents: number; buckets: { label: string; count: number; valueCents: number; holdingCents: number }[]; salesLast90: number; daysOfInventory: number | null; turnover90: number | null; belowFipe: number; withFipe: number; priceToFipePct: number | null; oldest: { id: string; label: string; days: number; price: number; holdingCents: number; suggestion: number | null }[] }
 mix: { brand: Mix[]; body: Mix[] }
 funnel: { leads: number; won: number; lost: number; open: number; conversionPct: number | null; reached: { stage: string; count: number }[]; lossReasons: { reason: string; count: number }[]; sources: { source: string; leads: number; won: number; lost: number; conversionPct: number | null }[]; previous: { leads: number; won: number; conversionPct: number | null }; pipeline: { stage: string; count: number }[] }
 team: { id: string; name: string; role: string; sales: number; revenueCents: number; marginCents: number; marginPct: number | null; commissionCents: number; leads: number; won: number; conversionPct: number | null; openLeads: number }[]
 cash: { next30: { projectedIn: number; projectedOut: number }; endBalanceCents: number; startBalanceCents: number; overdue: { incomeCents: number; expenseCents: number } }
 tips: { tone: 'good' | 'bad' | 'warn' | 'info'; title: string; detail: string; target?: Destination }[]
}
const pct = (v: number | null) => v === null ? '—' : `${v.toLocaleString('pt-BR')}%`
const pp = (a: number | null, b: number | null) => a === null || b === null ? null : Math.round((a - b) * 10) / 10
const t0 = today(), monthStart = t0.slice(0, 8) + '01'
const lastMonthEnd = addDays(monthStart, -1)
const PERIODS = [['Este mês', monthStart, t0], ['Mês passado', lastMonthEnd.slice(0, 8) + '01', lastMonthEnd], ['Últimos 90 dias', addDays(t0, -89), t0], ['Este ano', t0.slice(0, 4) + '-01-01', t0]] as const
const TIP_ICON = { good: TrendingUp, bad: TrendingDown, warn: AlertTriangle, info: Info }

export default function Insights({ storeId, view, onNavigate }: { storeId: string; view: string; onNavigate: (d: Destination) => void }) {
 const [period, setPeriod] = useState<[string, string]>([monthStart, t0]), [custom, setCustom] = useState(false)
 const { data, error } = useResource<Report>(`/api/admin/insights?from=${period[0]}&to=${period[1]}`, storeId)
 return <>
  <div className="dn-filters"><div className="dn-chips" role="group" aria-label="Período">{PERIODS.map(([l, a, b]) => <button key={l} className={`admin-chip ${!custom && period[0] === a && period[1] === b ? 'active' : ''}`} onClick={() => { setCustom(false); setPeriod([a, b]) }}>{l}</button>)}<button className={`admin-chip ${custom ? 'active' : ''}`} onClick={() => setCustom(true)}>Personalizado</button></div>
   {custom && <><input type="date" aria-label="De" value={period[0]} max={period[1]} onChange={e => e.target.value && setPeriod([e.target.value, period[1]])} /><input type="date" aria-label="Até" value={period[1]} min={period[0]} onChange={e => e.target.value && setPeriod([period[0], e.target.value])} /></>}
   {data && <span className="dn-muted">Comparando com {dateBR(data.previous.from)} a {dateBR(data.previous.to)}</span>}</div>
  {error && <Notice>{error}</Notice>}
  {!data ? !error && <div className="admin-empty">Calculando indicadores…</div> : <>
   {view === 'all' && <Overview r={data} onNavigate={onNavigate} />}
   {view === 'dre' && <DreView r={data} />}
   {view === 'stock' && <StockView r={data} onNavigate={onNavigate} />}
   {view === 'funnel' && <FunnelView r={data} />}
   {view === 'team' && <TeamView r={data} />}
  </>}
 </>
}

function Kpi({ label, value, delta, note, invert }: { label: string; value: string; delta?: number | null; note?: string; invert?: boolean }) {
 return <div><span>{label}</span><strong>{value}</strong><small>{delta !== undefined && <Delta value={delta} invert={invert} />}{note && <> {note}</>}</small></div>
}

function Overview({ r, onNavigate }: { r: Report; onNavigate: (d: Destination) => void }) {
 const s = r.sales.current, p = r.sales.previous
 return <>
  <div className="admin-stats dn-kpis">
   <Kpi label="Faturamento" value={money(s.revenueCents)} delta={r.sales.changes.revenue} note={`${s.count} vendas`} />
   <Kpi label="Margem líquida" value={money(s.marginCents)} delta={r.sales.changes.margin} note={s.marginPct === null ? '' : `${pct(s.marginPct)} das vendas`} />
   <Kpi label="Ticket médio" value={money(s.avgTicketCents)} delta={r.sales.changes.ticket} />
   <Kpi label="Resultado operacional" value={money(r.dre.current.resultCents)} delta={r.dre.previous.resultCents ? Math.round(((r.dre.current.resultCents - r.dre.previous.resultCents) / Math.abs(r.dre.previous.resultCents)) * 1000) / 10 : null} note={pct(r.dre.current.resultPct)} />
   <Kpi label="Dias para vender" value={s.avgDaysToSell === null ? '—' : `${s.avgDaysToSell} dias`} delta={s.avgDaysToSell !== null && p.avgDaysToSell ? Math.round(((s.avgDaysToSell - p.avgDaysToSell) / p.avgDaysToSell) * 1000) / 10 : null} invert />
   <Kpi label="Conversão de leads" value={pct(r.funnel.conversionPct)} delta={pp(r.funnel.conversionPct, r.funnel.previous.conversionPct)} note={`${r.funnel.won} de ${r.funnel.leads}`} />
   <Kpi label="Estoque" value={money(r.stock.valueCents)} note={`${r.stock.count} carros · ${r.stock.avgDays} dias em média`} />
   <Kpi label="Caixa em 30 dias" value={money(r.cash.endBalanceCents)} note={`+${money(r.cash.next30.projectedIn)} / −${money(r.cash.next30.projectedOut)}`} />
  </div>
  <section className="admin-card dn-pad dn-tips"><h2><Lightbulb size={18} /> O que os números estão dizendo</h2><ul>{r.tips.map((t, i) => { const Icon = TIP_ICON[t.tone]; return <li key={i} className={t.tone}><Icon size={18} /><div><strong>{t.title}</strong><p>{t.detail}</p></div>{t.target && <button className="admin-text-button" onClick={() => onNavigate(t.target!)}>Ver <ArrowRight size={13} /></button>}</li> })}</ul></section>
  <div className="dn-grid-2">
   <section className="admin-card dn-pad"><h2>Faturamento nos últimos 12 meses</h2><Bars rows={r.series.map(m => ({ label: monthLabel(m.month), value: m.revenueCents, note: `${m.sales} vendas · margem ${pct(m.marginPct)}` }))} label="Faturamento mensal" empty="Ainda não há vendas concluídas." /></section>
   <section className="admin-card dn-pad"><h2>Caixa realizado por mês</h2><BarPair rows={r.series.map(m => ({ label: monthLabel(m.month), a: m.cashInCents, b: m.cashOutCents }))} labels={['Entradas', 'Saídas']} empty="Nenhuma baixa registrada no financeiro." /></section>
  </div>
  {s.pendingCost > 0 && <div className="admin-notice">{s.pendingCost} venda(s) do período sem custo registrado: margem e resultado consideram apenas as vendas com custo conhecido.</div>}
 </>
}

function DreView({ r }: { r: Report }) {
 const c = r.dre.current, p = r.dre.previous
 const row = (label: string, cur: number, prev: number, kind: 'base' | 'minus' | 'plus' | 'total' = 'base', share = true) => <tr className={`dn-dre-${kind}`}><td>{kind === 'minus' ? '(−) ' : kind === 'plus' ? '(+) ' : kind === 'total' ? '(=) ' : ''}{label}</td><td className="num">{moneyFull(cur)}</td><td className="num dn-muted">{share && c.revenueCents ? pct(Math.round((cur / c.revenueCents) * 1000) / 10) : ''}</td><td className="num">{moneyFull(prev)}</td><td className="num"><Delta value={prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null} invert={kind === 'minus'} /></td></tr>
 const lines = (items: Line[], prevItems: Line[], kind: 'minus' | 'plus') => items.map(x => <tr key={x.id} className="dn-dre-sub"><td>{x.name}</td><td className="num">{moneyFull(kind === 'minus' ? -x.cents : x.cents)}</td><td></td><td className="num">{moneyFull((kind === 'minus' ? -1 : 1) * (prevItems.find(y => y.id === x.id)?.cents || 0))}</td><td></td></tr>)
 return <>
  <section className="admin-card"><div className="admin-toolbar"><h2>Demonstrativo de resultado (DRE gerencial)</h2><span className="dn-muted">{dateBR(r.from)} a {dateBR(r.to)} · regime de competência</span></div>
   <div className="admin-table-wrap"><table className="admin-table dn-dre"><thead><tr><th>Conta</th><th className="num">Período</th><th className="num">% receita</th><th className="num">Anterior</th><th className="num">Variação</th></tr></thead><tbody>
    {row('Receita bruta de vendas', c.revenueCents, p.revenueCents)}
    {row('Custo dos veículos vendidos', -c.cogsCents, -p.cogsCents, 'minus')}
    {row('Lucro bruto', c.grossCents, p.grossCents, 'total')}
    {row('Comissões de venda', -c.commissionCents, -p.commissionCents, 'minus')}
    {row('Outras receitas', c.otherIncomeCents, p.otherIncomeCents, 'plus')}{lines(c.otherIncome, p.otherIncome, 'plus')}
    {row('Despesas operacionais', -c.opexCents, -p.opexCents, 'minus')}{lines(c.opex, p.opex, 'minus')}
    {row('Resultado operacional', c.resultCents, p.resultCents, 'total')}
   </tbody></table></div>
   <footer className="admin-table-footer">Vendas pela data de fechamento; demais lançamentos pelo vencimento. Despesas ligadas a um veículo (compra, preparação, repasse) entram no custo do carro vendido. Comissões seguem a regra da loja.{c.pendingCost ? ` ${c.pendingCost} venda(s) sem custo registrado: o lucro bruto está superestimado.` : ''}</footer>
  </section>
  <section className="admin-card dn-pad"><h2>Resultado operacional por mês</h2><Bars signed rows={r.series.map(m => ({ label: monthLabel(m.month), value: m.resultCents, note: `Faturamento ${money(m.revenueCents)} · despesas ${money(m.opexCents)}` }))} label="Resultado operacional" empty="Sem movimento nos últimos 12 meses." /></section>
 </>
}

function MixTable({ rows, title }: { rows: Mix[]; title: string }) {
 return <section className="admin-card"><div className="admin-toolbar"><h2>{title}</h2></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{title.includes('marca') ? 'Marca' : 'Carroceria'}</th><th className="num">Em estoque</th><th className="num">Valor em estoque</th><th className="num">Vendidos</th><th className="num">Margem</th><th className="num">Dias p/ vender</th></tr></thead><tbody>{rows.map(x => <tr key={x.key}><td><strong>{x.key}</strong></td><td className="num">{x.stock}</td><td className="num">{money(x.stockValueCents)}</td><td className="num">{x.sold}</td><td className="num">{pct(x.marginPct)}</td><td className="num">{x.avgDaysToSell ?? '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="admin-empty"><p>Sem dados.</p></div>}</div></section>
}

function StockView({ r, onNavigate }: { r: Report; onNavigate: (d: Destination) => void }) {
 const s = r.stock
 return <>
  <div className="admin-stats dn-kpis">
   <Kpi label="Valor anunciado" value={money(s.valueCents)} note={`${s.count} carros publicados`} />
   <Kpi label="Custo do estoque" value={money(s.costCents)} note={s.missingCost ? `${s.missingCost} sem custo` : 'Todos com custo'} />
   <Kpi label="Margem potencial" value={money(s.potentialMarginCents)} note={pct(s.potentialMarginPct)} />
   <Kpi label="Custo de carregar" value={money(s.holdingCents)} note="Oportunidade do capital parado" />
   <Kpi label="Idade média" value={`${s.avgDays} dias`} />
   <Kpi label="Cobertura" value={s.daysOfInventory === null ? '—' : `${s.daysOfInventory} dias`} note={`${s.salesLast90} vendas em 90 dias`} />
   <Kpi label="Giro (90 dias)" value={s.turnover90 === null ? '—' : `${s.turnover90.toLocaleString('pt-BR')}×`} note="Vendas ÷ estoque atual" />
   <Kpi label="Preço x FIPE" value={s.priceToFipePct === null ? '—' : `${s.priceToFipePct.toLocaleString('pt-BR')}%`} note={`${s.belowFipe} de ${s.withFipe} abaixo da FIPE`} />
  </div>
  <div className="dn-grid-2">
   <section className="admin-card dn-pad"><h2>Estoque por idade</h2><Bars rows={s.buckets.map(b => ({ label: b.label, value: b.valueCents, note: `${b.count} carros · carregamento ${money(b.holdingCents)}` }))} label="Valor anunciado por faixa de idade" empty="Sem carros publicados." /></section>
   <section className="admin-card dn-pad"><h2>Carros mais antigos</h2>{s.oldest.length ? <ul className="dn-oldest">{s.oldest.map(v => <li key={v.id}><div><strong>{v.label}</strong><small>{v.days} dias · {money(v.holdingCents)} de carregamento</small></div><b>{moneyFull(Math.round(v.price * 100)).replace(',00', '')}</b>{v.suggestion && <em>sugestão {moneyFull(Math.round(v.suggestion * 100)).replace(',00', '')}</em>}</li>)}</ul> : <p className="dn-muted">Sem carros publicados.</p>}<button className="admin-secondary" onClick={() => onNavigate({ screen: 'aging', view: 'all', label: 'Idade do estoque' })}>Revisar preços <ArrowRight size={14} /></button></section>
  </div>
  <MixTable rows={r.mix.brand} title="Desempenho por marca" />
  <MixTable rows={r.mix.body} title="Desempenho por carroceria" />
 </>
}

function FunnelView({ r }: { r: Report }) {
 const f = r.funnel, maxReason = f.lossReasons[0]?.count || 1
 return <>
  <div className="admin-stats dn-kpis">
   <Kpi label="Novos interessados" value={String(f.leads)} delta={f.previous.leads ? Math.round(((f.leads - f.previous.leads) / f.previous.leads) * 1000) / 10 : null} />
   <Kpi label="Vendas ganhas" value={String(f.won)} delta={f.previous.won ? Math.round(((f.won - f.previous.won) / f.previous.won) * 1000) / 10 : null} />
   <Kpi label="Taxa de conversão" value={pct(f.conversionPct)} delta={pp(f.conversionPct, f.previous.conversionPct)} note="p.p." />
   <Kpi label="Ainda em aberto" value={String(f.open)} note={`${f.lost} perdidos`} />
  </div>
  <div className="dn-grid-2">
   <section className="admin-card dn-pad"><h2>Funil dos interessados do período</h2><Funnel steps={f.reached.map(x => ({ label: STAGES[x.stage], count: x.count }))} /><p className="dn-muted">Cada interessado conta em todas as etapas que já alcançou, pelo histórico do atendimento.</p></section>
   <section className="admin-card dn-pad"><h2>Por que não fechou</h2>{f.lossReasons.length ? <ul className="dn-hbars">{f.lossReasons.map(x => <li key={x.reason}><span>{x.reason}</span><div className="dn-hbar"><i style={{ width: `${(x.count / maxReason) * 100}%` }} /></div><b>{x.count}</b></li>)}</ul> : <p className="dn-muted">Nenhuma oportunidade perdida no período.</p>}<h2 className="dn-mt">Funil atual (em aberto)</h2><ul className="dn-hbars">{f.pipeline.map(x => <li key={x.stage}><span>{STAGES[x.stage]}</span><div className="dn-hbar"><i style={{ width: `${(x.count / Math.max(1, ...f.pipeline.map(y => y.count))) * 100}%` }} /></div><b>{x.count}</b></li>)}</ul></section>
  </div>
  <section className="admin-card"><div className="admin-toolbar"><h2>Origem dos interessados</h2></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Origem</th><th className="num">Interessados</th><th className="num">Ganhos</th><th className="num">Perdidos</th><th className="num">Conversão</th></tr></thead><tbody>{f.sources.map(x => <tr key={x.source}><td><strong>{x.source}</strong></td><td className="num">{x.leads}</td><td className="num">{x.won}</td><td className="num">{x.lost}</td><td className="num"><strong>{pct(x.conversionPct)}</strong></td></tr>)}</tbody></table>{!f.sources.length && <div className="admin-empty"><p>Nenhum interessado no período.</p></div>}</div></section>
 </>
}

function TeamView({ r }: { r: Report }) {
 return <section className="admin-card"><div className="admin-toolbar"><h2>Equipe no período</h2></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Vendedor</th><th className="num">Vendas</th><th className="num">Faturamento</th><th className="num">Margem</th><th className="num">Comissão</th><th className="num">Leads recebidos</th><th className="num">Conversão</th><th className="num">Em atendimento</th></tr></thead><tbody>{r.team.map(t => <tr key={t.id}><td><strong>{t.name}</strong><small>{t.role === 'seller' ? 'Vendedor' : 'Administrador'}</small></td><td className="num">{t.sales}</td><td className="num">{money(t.revenueCents)}</td><td className="num">{money(t.marginCents)}<small>{pct(t.marginPct)}</small></td><td className="num">{money(t.commissionCents)}</td><td className="num">{t.leads}</td><td className="num"><strong>{pct(t.conversionPct)}</strong></td><td className="num">{t.openLeads}</td></tr>)}</tbody></table>{!r.team.length && <div className="admin-empty"><p>Cadastre a equipe em Administrativo › Equipe e acessos.</p></div>}</div><footer className="admin-table-footer">Leads recebidos e conversão consideram os interessados criados no período e atribuídos ao vendedor.</footer></section>
}
