import { useEffect, useState, type FormEvent } from 'react'
import { Hourglass, Info, RefreshCw, Save, TrendingDown, Wrench } from 'lucide-react'
import { request } from './api'

type Settings = { alertDays: [number, number, number]; monthlyRatePct: number; dailyCostCents: number; minMarginPct: number }
type Row = {
  id: string; revision: number; label: string; image: string; status: string; price: number; fipe: number | null; entryDate: string; entrySource: 'purchase' | 'consignment' | 'listed' | 'estimated'
  days: number; band: 0 | 1 | 2 | 3; costCents: number | null; marginCents: number | null; marginPct: number | null; holdingCents: number
  preparation: { id: string; status: 'in_progress' | 'ready'; days: number } | null; priceHistory: { from: number; to: number; at: string; by: string }[]
  suggestion: { price: number | null; cutPct: number; floor: number | null; reason: string } | null
}
type Report = { settings: Settings; vehicles: Row[]; totals: { vehicles: number; avgDays: number; stale: number; holdingCents: number; stockCents: number } }

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const SOURCE: Record<Row['entrySource'], string> = { purchase: 'compra', consignment: 'consignação', listed: 'cadastro', estimated: 'estimada' }
const STATUS: Record<string, string> = { available: 'Disponível', reserved: 'Reservado', draft: 'Rascunho' }

export default function StockAging({ storeId }: { storeId: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    request<Report>('/api/admin/stock-aging', {}, storeId)
      .then((r) => active && (setReport(r), setError('')))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar a idade do estoque.'))
    return () => { active = false }
  }, [storeId, reload])

  const apply = async (row: Row) => {
    const price = row.suggestion?.price
    if (!price || !confirm(`Alterar o preço do ${row.label} de ${reais(row.price)} para ${reais(price)}? O anúncio é atualizado na hora.`)) return
    setBusy(row.id)
    setNotice('')
    try {
      await request(`/api/admin/stock-aging/${row.id}/price`, { method: 'POST', body: JSON.stringify({ revision: row.revision, price, reason: row.suggestion?.reason }) }, storeId)
      setNotice(`Preço do ${row.label} atualizado para ${reais(price)}.`)
      setReload((n) => n + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível alterar o preço.')
    } finally {
      setBusy('')
    }
  }

  const t = report?.totals
  const [a, b, c] = report?.settings.alertDays || [30, 60, 90]
  return (
    <>
      {error && <div className="admin-notice" role="alert">{error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></div>}
      {notice && <div className="commercial-success" role="status">{notice}</div>}
      <div className="admin-section-actions">
        <span>Dias desde a entrada no estoque, mais antigos primeiro. Alertas em {a}, {b} e {c} dias.</span>
        <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
      </div>
      <div className="admin-stats">
        <div><span>Em estoque</span><strong>{t?.vehicles ?? '—'}</strong><small>{t ? `${money(t.stockCents)} em capital` : ''}</small></div>
        <div><span>Idade média</span><strong>{t ? `${t.avgDays} dias` : '—'}</strong><small>desde a entrada</small></div>
        <div><span>Parados há {b}+ dias</span><strong className={t?.stale ? 'perf-negative' : ''}>{t?.stale ?? '—'}</strong><small>pedem ação de preço</small></div>
        <div><span>Custo de manter</span><strong>{t ? money(t.holdingCents) : '—'}</strong><small>{report ? `${report.settings.monthlyRatePct.toLocaleString('pt-BR')}% a.m. sobre o custo${report.settings.dailyCostCents ? ` + ${money(report.settings.dailyCostCents)}/dia` : ''}` : ''}</small></div>
      </div>
      <section className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table aging-table">
            <thead><tr><th>Veículo</th><th>Dias</th><th>Preço / FIPE</th><th>Custo / margem</th><th>Custo parado</th><th>Sugestão</th></tr></thead>
            <tbody>
              {report?.vehicles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="aging-car">
                      {r.image ? <img src={r.image} alt="" loading="lazy" /> : <span />}
                      <div><strong>{r.label}</strong><small>{STATUS[r.status] || r.status}{r.preparation && <> · <Wrench size={12} /> {r.preparation.status === 'in_progress' ? `em preparação (${r.preparation.days}d)` : `preparado em ${r.preparation.days}d`}</>}</small></div>
                    </div>
                  </td>
                  <td><em className={`aging-days band-${r.band}`}>{r.days}</em><small>desde {new Date(r.entryDate + 'T12:00:00').toLocaleDateString('pt-BR')} ({SOURCE[r.entrySource]})</small>{(r.entrySource === 'listed' || r.entrySource === 'estimated') && <EntryDate row={r} storeId={storeId} onSaved={() => setReload((n) => n + 1)} />}</td>
                  <td><strong>{reais(r.price)}</strong>{r.fipe ? <small className={r.price > r.fipe * 1.05 ? 'perf-negative' : ''}>FIPE {reais(r.fipe)} · {r.price >= r.fipe ? '+' : ''}{Math.round(((r.price - r.fipe) / r.fipe) * 100)}%</small> : <small>sem FIPE</small>}</td>
                  <td>{r.costCents === null ? <small className="perf-muted">custo não lançado</small> : <><span>{money(r.costCents)}</span><small className={(r.marginPct ?? 0) < (report?.settings.minMarginPct ?? 0) ? 'perf-negative' : 'perf-positive'}>margem {r.marginPct?.toLocaleString('pt-BR')}%</small></>}</td>
                  <td>{money(r.holdingCents)}{r.costCents === null && <small>estimado pelo preço</small>}</td>
                  <td className="aging-suggestion">
                    {r.suggestion?.price ? (
                      <>
                        <button type="button" className="admin-secondary" disabled={busy === r.id} onClick={() => apply(r)}><TrendingDown size={15} /> {reais(r.suggestion.price)}</button>
                        <small>{r.suggestion.reason}</small>
                      </>
                    ) : r.suggestion ? <small>{r.suggestion.reason}</small> : <small className="perf-muted">{r.status === 'available' ? 'Dentro do prazo' : '—'}</small>}
                    {!!r.priceHistory.length && <small className="aging-history" title={r.priceHistory.map((h) => `${new Date(h.at).toLocaleDateString('pt-BR')}: ${reais(h.from)} → ${reais(h.to)} (${h.by})`).join('\n')}>{r.priceHistory.length} ajuste(s) de preço</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report && !report.vehicles.length && <div className="admin-empty"><Hourglass size={32} /><h3>Nenhum veículo em estoque</h3><p>Os carros aparecem aqui assim que entram no estoque.</p></div>}
        </div>
      </section>
      <p className="perf-hint"><Info size={14} /> A data de entrada vem da compra ou da consignação registrada; sem elas, do cadastro do veículo. A sugestão nunca fica abaixo da margem mínima sobre o custo real (compra + despesas).</p>
      {report && <SettingsForm key={JSON.stringify(report.settings)} settings={report.settings} storeId={storeId} onSaved={() => setReload((n) => n + 1)} />}
    </>
  )
}

/** Ajuste da data de entrada quando ela não vem de uma compra ou consignação registrada. */
function EntryDate({ row, storeId, onSaved }: { row: Row; storeId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(row.entryDate)
  const [error, setError] = useState('')
  const max = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  if (!open) return <button type="button" className="admin-text-button aging-adjust" onClick={() => setOpen(true)}>ajustar data</button>
  const save = async () => {
    setError('')
    try {
      await request(`/api/admin/stock-aging/${row.id}/entry`, { method: 'POST', body: JSON.stringify({ revision: row.revision, date }) }, storeId)
      setOpen(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    }
  }
  return (
    <span className="aging-entry">
      <input type="date" aria-label="Data de entrada no estoque" max={max} value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="button" className="admin-text-button" onClick={save}>Salvar</button>
      {error && <small className="perf-negative">{error}</small>}
    </span>
  )
}

function SettingsForm({ settings, storeId, onSaved }: { settings: Settings; storeId: string; onSaved: () => void }) {
  const [days, setDays] = useState(settings.alertDays.map(String))
  const [rate, setRate] = useState(String(settings.monthlyRatePct).replace('.', ','))
  const [daily, setDaily] = useState(String(settings.dailyCostCents / 100).replace('.', ','))
  const [margin, setMargin] = useState(String(settings.minMarginPct).replace('.', ','))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const num = (v: string) => Number(v.replace(',', '.'))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await request('/api/admin/stock-aging/settings', { method: 'PUT', body: JSON.stringify({ alertDays: days.map(Number), monthlyRatePct: num(rate), dailyCostCents: Math.round(num(daily) * 100), minMarginPct: num(margin) }) }, storeId)
      onSaved()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-card perf-section">
      <div className="admin-toolbar"><h2>Regras de alerta e preço</h2></div>
      <form className="perf-rule" onSubmit={submit}>
        <fieldset disabled={busy} className="aging-settings">
          {['Primeiro alerta (dias)', 'Segundo alerta (dias)', 'Alerta crítico (dias)'].map((label, i) => (
            <label key={label} className="admin-field"><span>{label}</span><input inputMode="numeric" value={days[i]} onChange={(e) => setDays(days.map((d, j) => (j === i ? e.target.value.replace(/\D/g, '') : d)))} /></label>
          ))}
          <label className="admin-field"><span>Custo do capital (% ao mês)</span><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="admin-field"><span>Custo fixo por dia (R$)</span><input inputMode="decimal" placeholder="pátio, seguro…" value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
          <label className="admin-field"><span>Margem mínima (%)</span><input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></label>
          <p className="perf-muted perf-note">Sugestão de redução: 2% no primeiro alerta, 4% no segundo e 6% no crítico, arredondada para preço de anúncio (…490 ou …990). Carros mais de 5% acima da FIPE são aproximados de FIPE + 3%.</p>
          {message && <div className="admin-notice" role="alert">{message}</div>}
          <button className="admin-primary"><Save size={16} /> {busy ? 'Salvando…' : 'Salvar regras'}</button>
        </fieldset>
      </form>
    </section>
  )
}
