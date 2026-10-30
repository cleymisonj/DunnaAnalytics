import { useEffect, useState, type ReactNode } from 'react'
import { AlarmClock, ArrowRight, Camera, CheckCircle2, FileWarning, Hourglass, RefreshCw, UserPlus, Wallet, Wrench } from 'lucide-react'
import { request, APPRAISAL_STATUS, type User } from './api'
import type { Destination } from './Navigation'

type LeadItem = { id: string; name: string; interest: string; source: string; nextContactAt: string; createdAt: string }
type Side = { overdueCount: number; overdueCents: number; weekCount: number; weekCents: number }
type Report = {
  today: string
  role: User['role']
  leads: { overdue: number; today: number; untouched: number; newThisWeek: number; open: number; next: LeadItem[]; untouchedList: LeadItem[] }
  sales: { count: number; saleCents: number; commissionCents: number; marginCents: number | null; marginPct: number | null }
  appraisals?: { waiting: number; list: { id: string; name: string; model: string; year: number; status: keyof typeof APPRAISAL_STATUS; createdAt: string }[] }
  stock?: { vehicles: number; avgDays: number; stockCents: number; holdingCents: number; stale: number; staleList: { id: string; label: string; days: number; price: number; suggestion: number | null }[]; withSuggestion: number; preparing: number; preparingList: { id: string; label: string; days: number; done: number; total: number }[] }
  finance?: { payable: Side; receivable: Side }
  legal?: { unsigned: number; processesWithPending: number; pendingItems: number }
}

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const time = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ago = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias` }

const GO = {
  crm: { screen: 'crm', view: 'all', label: 'Funil de oportunidades' },
  appraisals: { screen: 'appraisals', view: 'all', label: 'Avaliações de usados' },
  aging: { screen: 'aging', view: 'all', label: 'Idade do estoque' },
  preparation: { screen: 'preparation', view: 'all', label: 'Preparação' },
  payable: { screen: 'finance', view: 'expense', label: 'Contas a pagar' },
  receivable: { screen: 'finance', view: 'income', label: 'Contas a receber' },
  pendingDocs: { screen: 'contracts', view: 'pending', label: 'Documentos pendentes' },
  contracts: { screen: 'contracts', view: 'all', label: 'Contratos' },
  performance: { screen: 'performance', view: 'all', label: 'Margem e comissões' },
} satisfies Record<string, Destination>

export default function Dashboard({ storeId, user, onNavigate }: { storeId: string; user: User; onNavigate: (d: Destination) => void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    request<Report>('/api/admin/dashboard', {}, storeId)
      .then((r) => active && (setReport(r), setError('')))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar o painel.'))
    return () => { active = false }
  }, [storeId, reload])

  if (error) return <div className="admin-notice" role="alert">{error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></div>
  if (!report) return <p className="perf-muted">Carregando o painel…</p>
  const { leads, sales, appraisals, stock, finance, legal } = report
  const seller = report.role === 'seller'
  const followups = leads.overdue + leads.today

  return (
    <>
      <div className="admin-section-actions">
        <span>{new Date(report.today + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · {greeting()}, {user.name.split(' ')[0]}.</span>
        <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
      </div>

      <div className="admin-stats">
        <Stat label={seller ? 'Minhas vendas no mês' : 'Vendas no mês'} value={String(sales.count)} hint={`${money(sales.saleCents)} faturados`} onClick={() => onNavigate(GO.performance)} />
        {seller
          ? <Stat label="Minhas comissões" value={money(sales.commissionCents)} hint="no mês" onClick={() => onNavigate(GO.performance)} />
          : <Stat label="Margem no mês" value={sales.marginCents === null ? '—' : money(sales.marginCents)} hint={sales.marginPct !== null ? `${sales.marginPct.toLocaleString('pt-BR')}% sobre as vendas com custo` : 'sem vendas com custo'} onClick={() => onNavigate(GO.performance)} />}
        {stock
          ? <Stat label="Em estoque" value={String(stock.vehicles)} hint={`${money(stock.stockCents)} em capital`} onClick={() => onNavigate(GO.aging)} />
          : <Stat label="Interessados em aberto" value={String(leads.open)} hint={`${leads.newThisWeek} novo(s) na semana`} onClick={() => onNavigate(GO.crm)} />}
        {stock
          ? <Stat label="Idade média do estoque" value={`${stock.avgDays} dias`} hint={`${money(stock.holdingCents)} de custo parado`} onClick={() => onNavigate(GO.aging)} />
          : <Stat label="Retornos pendentes" value={String(followups)} hint="atrasados e de hoje" onClick={() => onNavigate(GO.crm)} />}
      </div>

      <div className="dash-grid">
        <Card icon={<AlarmClock size={18} />} title="Retornos de hoje" count={followups} tone={leads.overdue ? 'alert' : followups ? 'warn' : 'ok'} empty="Nenhum retorno atrasado ou para hoje." action="Abrir funil" onAction={() => onNavigate(GO.crm)}>
          {leads.overdue > 0 && <p className="dash-note">{leads.overdue} atrasado(s)</p>}
          <ul>{leads.next.map((l) => <li key={l.id}><strong>{l.name}</strong><small>{Date.parse(l.nextContactAt) < Date.now() ? 'atrasado · ' : ''}{time(l.nextContactAt)}{l.interest ? ` · ${l.interest}` : ''}</small></li>)}</ul>
        </Card>

        <Card icon={<UserPlus size={18} />} title="Novos sem atendimento" count={leads.untouched} tone={leads.untouched ? 'warn' : 'ok'} empty="Todos os interessados novos já têm próximo contato." action="Abrir funil" onAction={() => onNavigate(GO.crm)}>
          <ul>{leads.untouchedList.map((l) => <li key={l.id}><strong>{l.name}</strong><small>chegou {ago(l.createdAt)}{l.source ? ` · ${l.source}` : ''}</small></li>)}</ul>
        </Card>

        {appraisals && (
          <Card icon={<Camera size={18} />} title="Avaliações aguardando" count={appraisals.waiting} tone={appraisals.waiting ? 'warn' : 'ok'} empty="Nenhuma avaliação esperando resposta." action="Ver avaliações" onAction={() => onNavigate(GO.appraisals)}>
            <ul>{appraisals.list.map((a) => <li key={a.id}><strong>{a.model} {a.year}</strong><small>{a.name} · {APPRAISAL_STATUS[a.status].toLowerCase()} · {ago(a.createdAt)}</small></li>)}</ul>
          </Card>
        )}

        {stock && (
          <Card icon={<Hourglass size={18} />} title="Carros parados" count={stock.stale} tone={stock.stale ? 'alert' : 'ok'} empty="Nenhum carro parado além do segundo alerta." action={stock.withSuggestion ? `Ver ${stock.withSuggestion} sugestão(ões) de preço` : 'Ver idade do estoque'} onAction={() => onNavigate(GO.aging)}>
            <ul>{stock.staleList.map((v) => <li key={v.id}><strong>{v.label}</strong><small>{v.days} dias · {reais(v.price)}{v.suggestion ? ` → sugerido ${reais(v.suggestion)}` : ''}</small></li>)}</ul>
          </Card>
        )}

        {stock && (
          <Card icon={<Wrench size={18} />} title="Em preparação" count={stock.preparing} tone={stock.preparingList.some((p) => p.days > 10) ? 'warn' : 'neutral'} empty="Nenhum veículo em preparação." action="Abrir preparação" onAction={() => onNavigate(GO.preparation)}>
            <ul>{stock.preparingList.map((p) => <li key={p.id}><strong>{p.label}</strong><small>{p.days} dia(s) · {p.done}/{p.total} serviços</small></li>)}</ul>
          </Card>
        )}

        {finance && (
          <Card icon={<Wallet size={18} />} title="Contas" count={finance.payable.overdueCount + finance.receivable.overdueCount} tone={finance.payable.overdueCount || finance.receivable.overdueCount ? 'alert' : 'neutral'} empty="" action="">
            <div className="dash-money">
              <button type="button" onClick={() => onNavigate(GO.payable)}>
                <span>A pagar</span>
                {finance.payable.overdueCount > 0 && <strong className="perf-negative">{money(finance.payable.overdueCents)} atrasado</strong>}
                <small>{finance.payable.weekCount ? `${money(finance.payable.weekCents)} nos próximos 7 dias` : 'nada nos próximos 7 dias'}</small>
              </button>
              <button type="button" onClick={() => onNavigate(GO.receivable)}>
                <span>A receber</span>
                {finance.receivable.overdueCount > 0 && <strong className="perf-negative">{money(finance.receivable.overdueCents)} em atraso</strong>}
                <small>{finance.receivable.weekCount ? `${money(finance.receivable.weekCents)} nos próximos 7 dias` : 'nada nos próximos 7 dias'}</small>
              </button>
            </div>
          </Card>
        )}

        {legal && (
          <Card icon={<FileWarning size={18} />} title="Jurídico" count={legal.processesWithPending + legal.unsigned} tone={legal.processesWithPending ? 'warn' : 'ok'} empty="Contratos assinados e documentos em dia." action={legal.processesWithPending ? 'Ver documentos pendentes' : 'Ver contratos'} onAction={() => onNavigate(legal.processesWithPending ? GO.pendingDocs : GO.contracts)}>
            <ul>
              {legal.unsigned > 0 && <li><strong>{legal.unsigned} contrato(s) sem assinatura</strong><small>rascunhos e enviados</small></li>}
              {legal.processesWithPending > 0 && <li><strong>{legal.pendingItems} documento(s) obrigatório(s) pendente(s)</strong><small>em {legal.processesWithPending} processo(s)</small></li>}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function Stat({ label, value, hint, onClick }: { label: string; value: string; hint: string; onClick: () => void }) {
  return <button type="button" className="dash-stat" onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{hint}</small></button>
}

function Card({ icon, title, count, tone, empty, action, onAction, children }: { icon: ReactNode; title: string; count: number; tone: 'ok' | 'warn' | 'alert' | 'neutral'; empty: string; action: string; onAction?: () => void; children: ReactNode }) {
  return (
    <section className={`dash-card ${tone}`}>
      <header>{icon}<h2>{title}</h2><em>{count}</em></header>
      {count === 0 && empty ? <p className="dash-empty"><CheckCircle2 size={16} /> {empty}</p> : children}
      {action && onAction && <button type="button" className="dash-action" onClick={onAction}>{action} <ArrowRight size={14} /></button>}
    </section>
  )
}
