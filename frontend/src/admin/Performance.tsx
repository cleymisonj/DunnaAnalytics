import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BadgePercent, Info, RefreshCw, Save } from 'lucide-react'
import { request, type User } from './api'

type Rule = { base: 'sale' | 'margin'; percent: number; sellers: Record<string, number> }
type Sale = {
  dealId: string; closedAt: string; vehicleLabel: string; personName: string; sellerId: string; sellerName: string
  saleCents: number; acquisitionCents: number | null; expenseCents: number; costCents: number | null
  commissionCents: number | null; marginCents: number | null; marginPct: number | null
}
type SellerRow = { sellerId: string; sellerName: string; sales: number; saleCents: number; commissionCents: number; marginCents: number; pendingCost: number }
type Report = { rule: Rule; sales: Sale[]; sellers: SellerRow[]; totals: { sales: number; saleCents: number; commissionCents: number; marginCents: number; marginPct: number | null; pendingCost: number } }

// Centavos importam em comissão e margem; `brl` arredonda para reais.
const money = (cents: number | null) => (cents === null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (v: number | null) => (v === null ? '' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const PERIODS: Record<string, { label: string; range: () => [string, string] }> = {
  month: { label: 'Este mês', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)] } },
  last: { label: 'Mês passado', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))] } },
  quarter: { label: 'Últimos 90 dias', range: () => { const n = new Date(); return [iso(new Date(n.getTime() - 89 * 864e5)), iso(n)] } },
  year: { label: 'Este ano', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), 0, 1)), iso(n)] } },
  all: { label: 'Todo o período', range: () => ['', ''] },
}

export default function Performance({ storeId, user, users }: { storeId: string; user: User; users: User[] }) {
  const isSeller = user.role === 'seller'
  const [period, setPeriod] = useState('month')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    const [from, to] = PERIODS[period].range()
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })
    setLoading(true)
    setError('')
    request<Report>(`/api/admin/performance?${qs}`, {}, storeId)
      .then((r) => active && setReport(r))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar o relatório.'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [storeId, period, reload])

  const t = report?.totals
  return (
    <>
      {error && (
        <div className="admin-notice" role="alert">
          {error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button>
        </div>
      )}
      <div className="admin-section-actions">
        <span>{isSeller ? 'Suas vendas concluídas e comissões' : 'Vendas concluídas, margem líquida e comissões'}</span>
        <div className="perf-period">
          <select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="admin-stats">
        <div><span>Vendas</span><strong>{t?.sales ?? '—'}</strong><small>{t ? money(t.saleCents) + ' faturados' : ''}</small></div>
        {isSeller ? (
          <div><span>Ticket médio</span><strong>{t && t.sales ? money(Math.round(t.saleCents / t.sales)) : '—'}</strong><small>por venda</small></div>
        ) : (
          <div><span>Margem líquida</span><strong>{t ? money(t.marginCents) : '—'}</strong><small>{t?.marginPct != null ? pct(t.marginPct) + ' sobre as vendas com custo' : 'sem vendas com custo'}</small></div>
        )}
        <div><span>{isSeller ? 'Minhas comissões' : 'Comissões'}</span><strong>{t ? money(t.commissionCents) : '—'}</strong><small>{report ? ruleText(report.rule, isSeller ? user.id : '') : ''}</small></div>
        <div><span>Sem custo lançado</span><strong>{t?.pendingCost ?? '—'}</strong><small>{t?.pendingCost ? 'margem não calculada' : 'tudo calculado'}</small></div>
      </div>

      {!isSeller && t && t.pendingCost > 0 && (
        <p className="perf-hint"><Info size={14} /> {t.pendingCost} venda(s) sem custo de aquisição. Registre a compra em <strong>Compras e custos</strong> para calcular a margem.</p>
      )}

      <section className="admin-card">
        <div className="admin-toolbar"><h2>Vendas no período</h2></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th><th>Veículo</th><th>Cliente</th>{!isSeller && <th>Vendedor</th>}<th>Venda</th>
                {!isSeller && <th>Custo</th>}<th>Comissão</th>{!isSeller && <th>Margem</th>}
              </tr>
            </thead>
            <tbody>
              {report?.sales.map((s) => (
                <tr key={s.dealId}>
                  <td>{new Date(s.closedAt).toLocaleDateString('pt-BR')}</td>
                  <td><strong>{s.vehicleLabel}</strong></td>
                  <td>{s.personName || '—'}</td>
                  {!isSeller && <td>{s.sellerName || <span className="perf-muted">Sem vendedor</span>}</td>}
                  <td><strong>{money(s.saleCents)}</strong></td>
                  {!isSeller && (
                    <td>
                      {s.costCents === null ? <span className="perf-muted">Sem custo</span> : money(s.costCents)}
                      {s.costCents !== null && s.expenseCents > 0 && <small>{money(s.expenseCents)} em despesas</small>}
                    </td>
                  )}
                  <td>{s.commissionCents === null ? <span className="perf-muted">Aguarda custo</span> : money(s.commissionCents)}</td>
                  {!isSeller && (
                    <td>
                      {s.marginCents === null ? <span className="perf-muted">—</span> : <strong className={s.marginCents < 0 ? 'perf-negative' : 'perf-positive'}>{money(s.marginCents)}</strong>}
                      {s.marginPct !== null && <small>{pct(s.marginPct)}</small>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && report?.sales.length === 0 && (
            <div className="admin-empty"><BadgePercent size={32} /><h3>Nenhuma venda concluída no período</h3><p>As vendas aparecem aqui quando a negociação é concluída.</p></div>
          )}
        </div>
      </section>

      {!isSeller && report && report.sellers.length > 0 && (
        <section className="admin-card perf-section">
          <div className="admin-toolbar"><h2>Por vendedor</h2></div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Vendedor</th><th>Vendas</th><th>Faturamento</th><th>Margem</th><th>Comissão</th></tr></thead>
              <tbody>
                {report.sellers.map((s) => (
                  <tr key={s.sellerId || 'none'}>
                    <td><strong>{s.sellerName}</strong></td>
                    <td>{s.sales}</td>
                    <td>{money(s.saleCents)}</td>
                    <td>{money(s.marginCents)}{s.pendingCost > 0 && <small>{s.pendingCost} sem custo</small>}</td>
                    <td><strong>{money(s.commissionCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!isSeller && report && <RuleEditor key={JSON.stringify(report.rule)} rule={report.rule} users={users} storeId={storeId} onSaved={() => setReload((n) => n + 1)} />}
    </>
  )
}

function ruleText(rule: Rule, sellerId: string) {
  const p = (sellerId ? rule.sellers[sellerId] : undefined) ?? rule.percent
  if (!p) return 'regra de comissão não definida'
  return `${p.toLocaleString('pt-BR')}% sobre ${rule.base === 'sale' ? 'o valor da venda' : 'a margem'}`
}

function RuleEditor({ rule, users, storeId, onSaved }: { rule: Rule; users: User[]; storeId: string; onSaved: () => void }) {
  const team = useMemo(() => users.filter((u) => u.active !== 0 && u.role !== 'platform'), [users])
  const [base, setBase] = useState(rule.base)
  const [percent, setPercent] = useState(String(rule.percent))
  const [overrides, setOverrides] = useState<Record<string, string>>(Object.fromEntries(Object.entries(rule.sellers).map(([k, v]) => [k, String(v)])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const sellers = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v.replace(',', '.'))]))
      await request('/api/admin/commission-rules', { method: 'PUT', body: JSON.stringify({ base, percent: Number(percent.replace(',', '.')), sellers }) }, storeId)
      onSaved()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar a regra.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-card perf-section">
      <div className="admin-toolbar"><h2>Regra de comissão</h2></div>
      <form className="perf-rule" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label className="admin-field">
            <span>Calcular sobre</span>
            <select value={base} onChange={(e) => setBase(e.target.value as Rule['base'])}>
              <option value="sale">Valor da venda</option>
              <option value="margin">Margem da venda (venda − custo)</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Percentual padrão</span>
            <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ex.: 1,5" />
          </label>
          {team.length > 0 && (
            <div className="perf-overrides">
              <p>Percentual por vendedor <small>(vazio = usa o padrão)</small></p>
              {team.map((u) => (
                <label key={u.id} className="admin-field">
                  <span>{u.name}</span>
                  <input inputMode="decimal" placeholder={percent || '0'} value={overrides[u.id] ?? ''} onChange={(e) => setOverrides({ ...overrides, [u.id]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <p className="perf-muted perf-note">Sobre a margem, a comissão só é calculada quando o custo do veículo está lançado. Vendas sem vendedor não geram comissão.</p>
          {message && <div className="admin-notice" role="alert">{message}</div>}
          <button className="admin-primary"><Save size={16} /> {busy ? 'Salvando…' : 'Salvar regra'}</button>
        </fieldset>
      </form>
    </section>
  )
}
