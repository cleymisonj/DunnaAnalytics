import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Search, Landmark, Wallet, CreditCard, PiggyBank, Banknote, ArrowDownLeft, ArrowUpRight, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { request } from './api'
import { Field, Notice, messageOf, money, moneyFull, dateBR, today, addDays, monthLabel, toCents, centsInput, useResource } from './kit'
import { BarPair } from './Charts'

export type Payment = { id: string; date: string; amountCents: number; accountId: string; by: string }
export type Entry = { id: string; revision: number; direction: 'income' | 'expense'; description: string; amountCents: number; dueDate: string; status: 'open' | 'paid' | 'void'; paidDate: string; payments?: Payment[]; vehicleId: string; personId: string; source: string; categoryId?: string; accountId?: string; notes: string; customerName?: string; cancelReason?: string }
type Category = { id: string; name: string; direction: 'income' | 'expense'; active: boolean; system: boolean }
type Account = { id: string; name: string; kind: 'checking' | 'savings' | 'cash' | 'card' | 'other'; bank?: string; openingCents: number; openingDate: string; active: boolean }
type Settings = { categories: Category[]; accounts: Account[]; revision: number }
type Option = { id: string; label: string }
const SOURCE_CATEGORY: Record<string, string> = { sale: 'sale', deal: 'sale', purchase: 'purchase', trade: 'purchase', consignment: 'consignment', preparation: 'preparation' }
const SOURCE_LABEL: Record<string, string> = { sale: 'Venda', deal: 'Venda', purchase: 'Compra', trade: 'Troca', consignment: 'Consignação', preparation: 'Preparação', manual: 'Manual' }
const ACCOUNT_KIND = { checking: 'Conta corrente', savings: 'Poupança/aplicação', cash: 'Caixa físico', card: 'Cartão/maquininha', other: 'Outra' }
const ACCOUNT_ICON = { checking: Landmark, savings: PiggyBank, cash: Banknote, card: CreditCard, other: Wallet }
export const categoryOf = (e: Entry) => e.categoryId || SOURCE_CATEGORY[e.source] || (e.direction === 'income' ? 'other-income' : 'other-expense')
export const paidOf = (e: Entry) => e.status === 'paid' ? e.amountCents : e.status === 'void' ? 0 : (e.payments || []).reduce((s, p) => s + p.amountCents, 0)
export const restOf = (e: Entry) => e.status === 'open' ? e.amountCents - paidOf(e) : 0

export default function Finance({ storeId, view, focus }: { storeId: string; view: string; focus?: string }) {
 const settings = useResource<Settings>('/api/admin/finance/settings', storeId)
 const ledger = useResource<Entry[]>('/api/admin/ledger', storeId)
 const [toast, setToast] = useState('')
 useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t) }, [toast])
 const done = (message: string) => { setToast(message); ledger.reload(); settings.reload() }
 const error = settings.error || ledger.error
 if (error) return <Notice>{error}</Notice>
 if (!settings.data || !ledger.data) return <div className="admin-empty">Carregando financeiro…</div>
 const s = settings.data, entries = ledger.data
 return <>{toast && <div className="admin-toast" role="status">{toast}</div>}
  {view === 'all' && <Overview storeId={storeId} entries={entries} settings={s} />}
  {(view === 'income' || view === 'expense' || view === 'paid') && <Entries key={view} storeId={storeId} view={view} entries={entries} settings={s} focus={focus} onDone={done} />}
  {view === 'cashflow' && <CashFlow storeId={storeId} settings={s} />}
  {view === 'statement' && <Statement storeId={storeId} settings={s} />}
  {view === 'settings' && <SettingsEditor storeId={storeId} settings={s} onSaved={() => done('Contas e categorias salvas.')} />}
 </>
}

function Overview({ storeId, entries, settings }: { storeId: string; entries: Entry[]; settings: Settings }) {
 const t = today(), monthStart = t.slice(0, 8) + '01'
 const flow = useResource<{ accounts: (Account & { balanceCents: number })[]; unassignedCents: number; series: { period: string; projectedIn: number; projectedOut: number; realizedIn: number; realizedOut: number }[] }>(`/api/admin/finance/cashflow?from=${monthStart}&to=${addDays(t, 30)}&group=month`, storeId)
 const open = entries.filter(e => e.status === 'open')
 const sum = (rows: Entry[]) => rows.reduce((n, e) => n + restOf(e), 0)
 const late = (d: Entry['direction']) => open.filter(e => e.direction === d && e.dueDate < t)
 const balance = (flow.data?.accounts || []).filter(a => a.active).reduce((n, a) => n + a.balanceCents, 0) + (flow.data?.unassignedCents || 0)
 const names = new Map(settings.categories.map(c => [c.id, c.name]))
 const monthExpenses = new Map<string, number>()
 for (const e of entries.filter(e => e.direction === 'expense' && e.status !== 'void' && e.dueDate >= monthStart && e.dueDate <= t.slice(0, 8) + '31')) monthExpenses.set(categoryOf(e), (monthExpenses.get(categoryOf(e)) || 0) + e.amountCents)
 const topExpenses = [...monthExpenses].sort((a, b) => b[1] - a[1]).slice(0, 6), maxExpense = topExpenses[0]?.[1] || 1
 const upcoming = open.filter(e => e.dueDate <= addDays(t, 15)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10)
 return <>
  <div className="admin-stats">
   <div><span>Saldo em contas</span><strong>{flow.data ? money(balance) : '…'}</strong><small>Saldos iniciais + movimentos realizados</small></div>
   <div><span>A receber em aberto</span><strong>{money(sum(open.filter(e => e.direction === 'income')))}</strong><small className={late('income').length ? 'dn-bad' : ''}>{late('income').length ? `${money(sum(late('income')))} em atraso` : 'Nada em atraso'}</small></div>
   <div><span>A pagar em aberto</span><strong>{money(sum(open.filter(e => e.direction === 'expense')))}</strong><small className={late('expense').length ? 'dn-bad' : ''}>{late('expense').length ? `${money(sum(late('expense')))} em atraso` : 'Nada em atraso'}</small></div>
   <div><span>Saldo projetado (30 dias)</span><strong>{flow.data ? money(balance + sum(open.filter(e => e.direction === 'income' && e.dueDate <= addDays(t, 30))) - sum(open.filter(e => e.direction === 'expense' && e.dueDate <= addDays(t, 30)))) : '…'}</strong><small>Saldo atual ± contas que vencem</small></div>
  </div>
  <div className="dn-grid-2">
   <section className="admin-card dn-pad"><h2>Contas bancárias</h2>{flow.error && <Notice>{flow.error}</Notice>}<ul className="dn-accounts">{(flow.data?.accounts || []).filter(a => a.active).map(a => { const Icon = ACCOUNT_ICON[a.kind]; return <li key={a.id}><Icon size={18} /><div><strong>{a.name}</strong><small>{ACCOUNT_KIND[a.kind]}</small></div><b className={a.balanceCents < 0 ? 'dn-bad' : ''}>{moneyFull(a.balanceCents)}</b></li> })}{!!flow.data?.unassignedCents && <li><Wallet size={18} /><div><strong>Sem conta definida</strong><small>Baixas sem conta informada</small></div><b>{moneyFull(flow.data.unassignedCents)}</b></li>}</ul></section>
   <section className="admin-card dn-pad"><h2>Despesas do mês por categoria</h2>{topExpenses.length ? <ul className="dn-hbars">{topExpenses.map(([id, c]) => <li key={id}><span>{names.get(id) || id}</span><div className="dn-hbar"><i style={{ width: `${Math.max(2, (c / maxExpense) * 100)}%` }} /></div><b>{money(c)}</b></li>)}</ul> : <p className="dn-muted">Nenhuma despesa com vencimento neste mês.</p>}</section>
  </div>
  <section className="admin-card"><div className="admin-toolbar"><h2>Vencimentos dos próximos 15 dias</h2></div><EntryTable entries={upcoming} settings={settings} empty="Nenhum vencimento próximo." /></section>
 </>
}

function EntryTable({ entries, settings, empty, actions }: { entries: Entry[]; settings: Settings; empty: string; actions?: (e: Entry) => React.ReactNode }) {
 const names = new Map(settings.categories.map(c => [c.id, c.name])), accounts = new Map(settings.accounts.map(a => [a.id, a.name])), t = today()
 if (!entries.length) return <div className="admin-empty"><p>{empty}</p></div>
 return <div className="admin-table-wrap"><table className="admin-table dn-entries"><thead><tr><th>Vencimento</th><th>Descrição</th><th className="num">Valor</th><th className="num">Pago</th><th>Situação</th>{actions && <th></th>}</tr></thead><tbody>{entries.map(e => { const paid = paidOf(e), late = e.status === 'open' && e.dueDate < t; return <tr key={e.id} className={e.status === 'void' ? 'void' : ''}>
  <td>{dateBR(e.dueDate)}{late && <small className="dn-bad">em atraso</small>}</td>
  <td><strong className={e.direction === 'income' ? 'dn-in' : 'dn-out'}>{e.direction === 'income' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />} {e.description}</strong><small>{[names.get(categoryOf(e)), e.accountId && accounts.get(e.accountId), SOURCE_LABEL[e.source], e.customerName].filter(Boolean).join(' · ')}</small></td>
  <td className="num">{moneyFull(e.amountCents)}</td>
  <td className="num">{paid ? moneyFull(paid) : '—'}{e.status === 'open' && paid > 0 && <small>falta {moneyFull(e.amountCents - paid)}</small>}</td>
  <td><span className={`admin-status ${e.status === 'paid' ? 'available' : e.status === 'void' ? 'sold' : late ? 'overdue' : paid ? 'reserved' : 'draft'}`}>{e.status === 'paid' ? `Baixado ${dateBR(e.paidDate)}` : e.status === 'void' ? 'Cancelado' : paid ? 'Parcial' : 'Em aberto'}</span></td>
  {actions && <td><div className="admin-row-actions">{actions(e)}</div></td>}
 </tr> })}</tbody></table></div>
}

function Entries({ storeId, view, entries, settings, focus, onDone }: { storeId: string; view: string; entries: Entry[]; settings: Settings; focus?: string; onDone: (m: string) => void }) {
 const [query, setQuery] = useState(''), [status, setStatus] = useState(view === 'paid' ? 'all' : 'open'), [category, setCategory] = useState('all')
 const [creating, setCreating] = useState(false), [settling, setSettling] = useState<Entry | null>(null), [editing, setEditing] = useState<Entry | null>(null), [cancelling, setCancelling] = useState<Entry | null>(null), [error, setError] = useState('')
 useEffect(() => { if (focus) { const e = entries.find(x => x.id === focus); if (e) { setQuery(e.description); setStatus('all') } } }, [focus])
 const t = today(), direction = view === 'paid' ? null : view as Entry['direction']
 const rows = entries.filter(e => (view === 'paid' ? e.status === 'paid' : e.direction === direction))
  .filter(e => status === 'all' || (status === 'overdue' ? e.status === 'open' && e.dueDate < t : status === 'partial' ? e.status === 'open' && paidOf(e) > 0 : e.status === status))
  .filter(e => category === 'all' || categoryOf(e) === category)
  .filter(e => `${e.description} ${e.customerName || ''} ${e.notes}`.toLowerCase().includes(query.toLowerCase()))
  .sort((a, b) => view === 'paid' ? b.paidDate.localeCompare(a.paidDate) : a.dueDate.localeCompare(b.dueDate))
 const total = rows.reduce((n, e) => n + (view === 'paid' ? e.amountCents : restOf(e)), 0)
 const reopen = async (e: Entry) => { if (!window.confirm('Estornar os pagamentos deste lançamento? Ele volta a ficar em aberto.')) return; setError(''); try { const r = await request<{ message: string }>(`/api/admin/finance/entries/${e.id}/reopen`, { method: 'POST', body: JSON.stringify({ revision: e.revision }) }, storeId); onDone(r.message) } catch (err) { setError(messageOf(err)) } }
 return <section className="admin-card">
  <div className="admin-toolbar"><div className="admin-search"><Search size={17} /><input aria-label="Buscar lançamento" placeholder="Descrição, cliente…" value={query} onChange={e => setQuery(e.target.value)} /></div>
   <select aria-label="Situação" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todas as situações</option><option value="open">Em aberto</option><option value="overdue">Em atraso</option><option value="partial">Pagamento parcial</option><option value="paid">Baixados</option><option value="void">Cancelados</option></select>
   <select aria-label="Categoria" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Todas as categorias</option>{settings.categories.filter(c => !direction || c.direction === direction).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
   {direction && <button className="admin-primary" onClick={() => setCreating(true)}><Plus size={17} /> {direction === 'income' ? 'Nova receita' : 'Nova despesa'}</button>}</div>
  {error && <Notice>{error}</Notice>}
  <EntryTable entries={rows} settings={settings} empty="Nenhum lançamento encontrado com esses filtros." actions={e => <>{e.status === 'open' && <button className="admin-text-button" onClick={() => setSettling(e)}>Baixar</button>}{e.status !== 'void' && <button className="admin-text-button" onClick={() => setEditing(e)}>Editar</button>}{(e.status === 'paid' || (e.payments || []).length > 0) && e.status !== 'void' && <button className="admin-text-button" onClick={() => reopen(e)}>Estornar</button>}{e.status === 'open' && e.source === 'manual' && !(e.payments || []).length && <button className="admin-text-button" onClick={() => setCancelling(e)}>Cancelar</button>}</>} />
  <footer className="admin-table-footer">{rows.length} lançamentos · {view === 'paid' ? 'total baixado' : 'saldo em aberto'} {moneyFull(total)}</footer>
  {creating && direction && <NewEntry storeId={storeId} direction={direction} settings={settings} onClose={() => setCreating(false)} onSaved={m => { setCreating(false); onDone(m) }} />}
  {settling && <Settle storeId={storeId} entry={settling} settings={settings} onClose={() => setSettling(null)} onSaved={m => { setSettling(null); onDone(m) }} />}
  {editing && <EditEntry storeId={storeId} entry={editing} settings={settings} onClose={() => setEditing(null)} onSaved={m => { setEditing(null); onDone(m) }} />}
  {cancelling && <CancelEntry storeId={storeId} entry={cancelling} onClose={() => setCancelling(null)} onSaved={m => { setCancelling(null); onDone(m) }} />}
 </section>
}

function useOptions(storeId: string) {
 const [cars, setCars] = useState<Option[]>([]), [people, setPeople] = useState<Option[]>([])
 useEffect(() => { request<{ id: string; brand: string; model: string; version: string; year: number; plate?: string }[]>('/api/admin/stock', {}, storeId).then(r => setCars(r.map(v => ({ id: v.id, label: `${v.brand} ${v.model} ${v.version} ${v.year}${v.plate ? ' · ' + v.plate : ''}` })))).catch(() => {}); request<{ id: string; name: string }[]>('/api/admin/people', {}, storeId).then(r => setPeople(r.map(p => ({ id: p.id, label: p.name })))).catch(() => {}) }, [storeId])
 return { cars, people }
}

function NewEntry({ storeId, direction, settings, onClose, onSaved }: { storeId: string; direction: Entry['direction']; settings: Settings; onClose: () => void; onSaved: (m: string) => void }) {
 const { cars, people } = useOptions(storeId)
 const [v, setV] = useState({ description: '', amount: '', dueDate: today(), categoryId: '', accountId: '', vehicleId: '', personId: '', notes: '', count: 1, mode: 'monthly' }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const cents = toCents(v.amount)
 const submit = async (e: FormEvent) => { e.preventDefault(); if (!(cents > 0)) { setError('Informe um valor válido.'); return } setBusy(true); setError(''); try { const r = await request<Entry[]>('/api/admin/finance/entries', { method: 'POST', body: JSON.stringify({ direction, description: v.description, amountCents: cents, dueDate: v.dueDate, categoryId: v.categoryId, accountId: v.accountId, vehicleId: v.vehicleId, personId: v.personId, notes: v.notes, repeat: { count: Number(v.count), mode: v.mode } }) }, storeId); onSaved(r.length > 1 ? `${r.length} lançamentos criados.` : 'Lançamento criado em aberto.') } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <Dialog open onOpenChange={o => !o && !busy && onClose()} title={direction === 'income' ? 'Nova receita' : 'Nova despesa'} description="Classifique por categoria e conta para o fluxo de caixa e o resultado ficarem corretos." className="admin-root admin-dialog max-w-2xl"><form onSubmit={submit} className="admin-editor"><fieldset disabled={busy}><div className="admin-form-grid">
  <Field label="Descrição *" wide><input required maxLength={200} placeholder={direction === 'income' ? 'Ex.: Retorno financiamento banco' : 'Ex.: Aluguel do pátio'} value={v.description} onChange={e => setV({ ...v, description: e.target.value })} /></Field>
  <Field label="Valor (R$) *"><input required inputMode="decimal" placeholder="0,00" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} /></Field>
  <Field label="Vencimento *"><input type="date" required value={v.dueDate} onChange={e => setV({ ...v, dueDate: e.target.value })} /></Field>
  <Field label="Categoria"><select value={v.categoryId} onChange={e => setV({ ...v, categoryId: e.target.value })}><option value="">{direction === 'income' ? 'Outras receitas' : 'Outras despesas'}</option>{settings.categories.filter(c => c.direction === direction && c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
  <Field label="Conta prevista"><select value={v.accountId} onChange={e => setV({ ...v, accountId: e.target.value })}><option value="">Definir na baixa</option>{settings.accounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
  <Field label="Repetir"><select value={v.count > 1 ? v.mode : 'once'} onChange={e => setV({ ...v, mode: e.target.value === 'once' ? 'monthly' : e.target.value, count: e.target.value === 'once' ? 1 : Math.max(2, v.count) })}><option value="once">Lançamento único</option><option value="monthly">Mensal (mesmo valor)</option><option value="installments">Parcelado (divide o valor)</option></select></Field>
  {v.count > 1 && <Field label={v.mode === 'installments' ? 'Número de parcelas' : 'Quantidade de meses'}><input type="number" min={2} max={60} value={v.count} onChange={e => setV({ ...v, count: Math.min(60, Math.max(2, Number(e.target.value) || 2)) })} /></Field>}
  {v.count > 1 && cents > 0 && <p className="dn-muted wide">{v.mode === 'installments' ? `${v.count} parcelas de cerca de ${moneyFull(Math.floor(cents / v.count))}` : `${v.count} lançamentos de ${moneyFull(cents)}, total ${moneyFull(cents * v.count)}`}, todo mês a partir de {dateBR(v.dueDate)}.</p>}
  <Field label="Veículo (custo do carro)"><select value={v.vehicleId} onChange={e => setV({ ...v, vehicleId: e.target.value })}><option value="">Despesa geral da loja</option>{cars.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
  <Field label="Pessoa / fornecedor"><select value={v.personId} onChange={e => setV({ ...v, personId: e.target.value })}><option value="">—</option>{people.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
  <Field label="Observações" wide><textarea rows={2} maxLength={2000} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} /></Field>
 </div></fieldset>{v.vehicleId && direction === 'expense' && <p className="dn-muted">Despesas ligadas a um veículo entram no custo dele e na margem da venda, não nas despesas operacionais.</p>}{error && <Notice>{error}</Notice>}<footer className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="admin-primary" disabled={busy}>{busy ? 'Salvando…' : 'Criar lançamento'}</button></footer></form></Dialog>
}

function Settle({ storeId, entry, settings, onClose, onSaved }: { storeId: string; entry: Entry; settings: Settings; onClose: () => void; onSaved: (m: string) => void }) {
 const rest = restOf(entry)
 const [v, setV] = useState({ amount: centsInput(rest), date: today(), accountId: entry.accountId || settings.accounts.find(a => a.active)?.id || '' }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const cents = toCents(v.amount)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await request<{ message: string }>(`/api/admin/finance/entries/${entry.id}/settle`, { method: 'POST', body: JSON.stringify({ revision: entry.revision, amountCents: cents, date: v.date, accountId: v.accountId }) }, storeId); onSaved(r.message) } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <Dialog open onOpenChange={o => !o && !busy && onClose()} title={entry.direction === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'} description={`${entry.description} · saldo em aberto ${moneyFull(rest)}`} className="admin-root admin-dialog"><form onSubmit={submit} className="admin-editor"><fieldset disabled={busy} className="admin-form-grid">
  <Field label="Valor pago (R$) *"><input required inputMode="decimal" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} /></Field>
  <Field label="Data *"><input type="date" required max={today()} value={v.date} onChange={e => setV({ ...v, date: e.target.value })} /></Field>
  <Field label="Conta" wide><select value={v.accountId} onChange={e => setV({ ...v, accountId: e.target.value })}><option value="">Sem conta</option>{settings.accounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
 </fieldset>{cents > 0 && cents < rest && <p className="dn-muted">Pagamento parcial: continuarão em aberto {moneyFull(rest - cents)}.</p>}{(entry.payments || []).length > 0 && <ul className="dn-payments">{entry.payments!.map(p => <li key={p.id}>{dateBR(p.date)} · {moneyFull(p.amountCents)} · {p.by}</li>)}</ul>}{error && <Notice>{error}</Notice>}<footer className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="admin-primary" disabled={busy || !(cents > 0)}>{busy ? 'Registrando…' : cents >= rest ? 'Baixar total' : 'Registrar parcial'}</button></footer></form></Dialog>
}

function EditEntry({ storeId, entry, settings, onClose, onSaved }: { storeId: string; entry: Entry; settings: Settings; onClose: () => void; onSaved: (m: string) => void }) {
 const terms = entry.source === 'manual' && entry.status === 'open' && !(entry.payments || []).length
 const [v, setV] = useState({ description: entry.description, amount: centsInput(entry.amountCents), dueDate: entry.dueDate, categoryId: entry.categoryId || '', accountId: entry.accountId || '', notes: entry.notes || '' }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await request<{ message: string }>(`/api/admin/finance/entries/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ revision: entry.revision, categoryId: v.categoryId, accountId: v.accountId, notes: v.notes, ...(terms ? { description: v.description, amountCents: toCents(v.amount), dueDate: v.dueDate } : {}) }) }, storeId); onSaved(r.message) } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <Dialog open onOpenChange={o => !o && !busy && onClose()} title="Editar lançamento" description={terms ? 'Lançamento manual em aberto: todos os campos podem ser ajustados.' : 'Valor e vencimento vêm do processo de origem ou já têm pagamento; ajuste a classificação.'} className="admin-root admin-dialog max-w-2xl"><form onSubmit={submit} className="admin-editor"><fieldset disabled={busy} className="admin-form-grid">
  <Field label="Descrição" wide><input disabled={!terms} required maxLength={200} value={v.description} onChange={e => setV({ ...v, description: e.target.value })} /></Field>
  <Field label="Valor (R$)"><input disabled={!terms} required inputMode="decimal" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} /></Field>
  <Field label="Vencimento"><input disabled={!terms} type="date" required value={v.dueDate} onChange={e => setV({ ...v, dueDate: e.target.value })} /></Field>
  <Field label="Categoria"><select value={v.categoryId} onChange={e => setV({ ...v, categoryId: e.target.value })}><option value="">Automática ({settings.categories.find(c => c.id === categoryOf({ ...entry, categoryId: '' }))?.name})</option>{settings.categories.filter(c => c.direction === entry.direction && (c.active || c.id === v.categoryId)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
  <Field label="Conta"><select value={v.accountId} onChange={e => setV({ ...v, accountId: e.target.value })}><option value="">Sem conta</option>{settings.accounts.filter(a => a.active || a.id === v.accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
  <Field label="Observações" wide><textarea rows={2} maxLength={2000} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} /></Field>
 </fieldset>{error && <Notice>{error}</Notice>}<footer className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="admin-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></footer></form></Dialog>
}

function CancelEntry({ storeId, entry, onClose, onSaved }: { storeId: string; entry: Entry; onClose: () => void; onSaved: (m: string) => void }) {
 const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await request<{ message: string }>(`/api/admin/finance/entries/${entry.id}/cancel`, { method: 'POST', body: JSON.stringify({ revision: entry.revision, reason }) }, storeId); onSaved(r.message) } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <Dialog open onOpenChange={o => !o && !busy && onClose()} title="Cancelar lançamento" description={`${entry.description} · ${moneyFull(entry.amountCents)}. O registro é mantido com o motivo, sem ser apagado.`} className="admin-root admin-dialog"><form onSubmit={submit} className="admin-editor"><Field label="Motivo *" wide><input required maxLength={500} placeholder="Ex.: lançado em duplicidade" value={reason} onChange={e => setReason(e.target.value)} /></Field>{error && <Notice>{error}</Notice>}<footer className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose} disabled={busy}>Voltar</button><button className="admin-primary" disabled={busy}>{busy ? 'Cancelando…' : 'Cancelar lançamento'}</button></footer></form></Dialog>
}

type Flow = { startBalanceCents: number; endBalanceCents: number; series: { period: string; realizedIn: number; realizedOut: number; projectedIn: number; projectedOut: number; balanceCents: number }[]; totals: { realizedIn: number; realizedOut: number; projectedIn: number; projectedOut: number }; overdue: { incomeCents: number; expenseCents: number } }
const RANGES = [['Últimos 6 meses', -5, 0], ['Próximos 6 meses', 0, 5], ['12 meses (6+6)', -5, 6], ['Este ano', null, null]] as const
const monthStart = (offset: number) => { const t = today(); const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 + offset, 1)); return d.toISOString().slice(0, 10) }
const monthEnd = (offset: number) => addDays(monthStart(offset + 1), -1)

function CashFlow({ storeId, settings }: { storeId: string; settings: Settings }) {
 const [range, setRange] = useState(2), [group, setGroup] = useState<'month' | 'day'>('month'), [account, setAccount] = useState('')
 const [a, b] = RANGES[range][1] === null ? [today().slice(0, 4) + '-01-01', today().slice(0, 4) + '-12-31'] : [monthStart(RANGES[range][1]!), monthEnd(RANGES[range][2]!)]
 const { data, error } = useResource<Flow>(`/api/admin/finance/cashflow?from=${a}&to=${b}&group=${group}&account=${account}`, storeId)
 const label = (p: string) => group === 'month' ? monthLabel(p) : dateBR(p).slice(0, 5)
 const rows = useMemo(() => (data?.series || []).map(r => ({ label: label(r.period), a: r.realizedIn + r.projectedIn, b: r.realizedOut + r.projectedOut, projected: r.projectedIn + r.projectedOut > 0 && r.realizedIn + r.realizedOut === 0 })), [data, group])
 return <>
  <div className="dn-filters"><div className="dn-chips" role="group" aria-label="Período">{RANGES.map(([l], i) => <button key={l} className={`admin-chip ${range === i ? 'active' : ''}`} onClick={() => setRange(i)}>{l}</button>)}</div><select aria-label="Agrupar" value={group} onChange={e => setGroup(e.target.value as 'month' | 'day')}><option value="month">Por mês</option><option value="day">Por dia</option></select><select aria-label="Conta" value={account} onChange={e => setAccount(e.target.value)}><option value="">Todas as contas</option>{settings.accounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="none">Sem conta definida</option></select></div>
  {error && <Notice>{error}</Notice>}
  {!data ? <div className="admin-empty">Calculando fluxo…</div> : <>
   <div className="admin-stats"><div><span>Saldo inicial</span><strong>{money(data.startBalanceCents)}</strong><small>Em {dateBR(a)}</small></div><div><span>Entradas</span><strong className="dn-in">{money(data.totals.realizedIn + data.totals.projectedIn)}</strong><small>{money(data.totals.realizedIn)} realizadas · {money(data.totals.projectedIn)} previstas</small></div><div><span>Saídas</span><strong className="dn-out">{money(data.totals.realizedOut + data.totals.projectedOut)}</strong><small>{money(data.totals.realizedOut)} realizadas · {money(data.totals.projectedOut)} previstas</small></div><div><span>Saldo final previsto</span><strong className={data.endBalanceCents < 0 ? 'dn-bad' : ''}>{money(data.endBalanceCents)}</strong><small>Em {dateBR(b)}</small></div></div>
   {(data.overdue.incomeCents > 0 || data.overdue.expenseCents > 0) && <div className="admin-notice">Valores em atraso entram como previstos para hoje: {money(data.overdue.incomeCents)} a receber e {money(data.overdue.expenseCents)} a pagar.</div>}
   <section className="admin-card dn-pad"><h2>Entradas e saídas</h2><BarPair rows={rows} labels={['Entradas', 'Saídas']} empty="Sem movimentos neste período." /></section>
   <section className="admin-card"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{group === 'month' ? 'Mês' : 'Dia'}</th><th className="num">Entradas realizadas</th><th className="num">Saídas realizadas</th><th className="num">A receber</th><th className="num">A pagar</th><th className="num">Saldo acumulado</th></tr></thead><tbody>{data.series.map(r => <tr key={r.period}><td>{group === 'month' ? monthLabel(r.period) : dateBR(r.period)}</td><td className="num">{money(r.realizedIn)}</td><td className="num">{money(r.realizedOut)}</td><td className="num">{money(r.projectedIn)}</td><td className="num">{money(r.projectedOut)}</td><td className={`num ${r.balanceCents < 0 ? 'dn-bad' : ''}`}><strong>{money(r.balanceCents)}</strong></td></tr>)}</tbody></table>{!data.series.length && <div className="admin-empty"><p>Sem movimentos neste período.</p></div>}</div></section>
  </>}
 </>
}

function Statement({ storeId, settings }: { storeId: string; settings: Settings }) {
 const [account, setAccount] = useState(settings.accounts.find(a => a.active)?.id || ''), [from, setFrom] = useState(today().slice(0, 8) + '01'), [to, setTo] = useState(today())
 const { data, error } = useResource<{ openingCents: number; closingCents: number; rows: { date: string; description: string; direction: string; amountCents: number; signedCents: number; balanceCents: number; categoryName: string }[] }>(`/api/admin/finance/statement?account=${account}&from=${from}&to=${to}`, storeId)
 const exportCsv = () => { if (!data) return; const lines = [['Data', 'Descrição', 'Categoria', 'Valor', 'Saldo'], ['', 'Saldo anterior', '', '', (data.openingCents / 100).toFixed(2)], ...data.rows.map(r => [dateBR(r.date), r.description, r.categoryName, (r.signedCents / 100).toFixed(2), (r.balanceCents / 100).toFixed(2)])].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'); const url = URL.createObjectURL(new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' })); const el = document.createElement('a'); el.href = url; el.download = `extrato-${from}-${to}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
 return <section className="admin-card"><div className="admin-toolbar"><select aria-label="Conta" value={account} onChange={e => setAccount(e.target.value)}><option value="">Consolidado (todas)</option>{settings.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="none">Sem conta definida</option></select><input type="date" aria-label="De" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /><input type="date" aria-label="Até" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /><button className="admin-secondary" disabled={!data} onClick={exportCsv}>Exportar CSV</button></div>
  {error && <Notice>{error}</Notice>}
  {!data ? <div className="admin-empty">Carregando extrato…</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Data</th><th>Descrição</th><th className="num">Valor</th><th className="num">Saldo</th></tr></thead><tbody><tr className="dn-row-muted"><td>{dateBR(from)}</td><td>Saldo anterior</td><td></td><td className="num"><strong>{moneyFull(data.openingCents)}</strong></td></tr>{data.rows.map((r, i) => <tr key={i}><td>{dateBR(r.date)}</td><td><strong>{r.description}</strong>{r.categoryName && <small>{r.categoryName}</small>}</td><td className={`num ${r.signedCents < 0 ? 'dn-out' : 'dn-in'}`}>{moneyFull(r.signedCents)}</td><td className={`num ${r.balanceCents < 0 ? 'dn-bad' : ''}`}>{moneyFull(r.balanceCents)}</td></tr>)}</tbody></table>{!data.rows.length && <div className="admin-empty"><p>Nenhum movimento realizado neste período.</p></div>}<footer className="admin-table-footer">{data.rows.length} movimentos · saldo final {moneyFull(data.closingCents)}</footer></div>}
 </section>
}

function SettingsEditor({ storeId, settings, onSaved }: { storeId: string; settings: Settings; onSaved: () => void }) {
 const [accounts, setAccounts] = useState(settings.accounts.map(a => ({ ...a, opening: centsInput(a.openingCents) }))), [categories, setCategories] = useState(settings.categories), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const save = async () => { setBusy(true); setError(''); try { await request('/api/admin/finance/settings', { method: 'PUT', body: JSON.stringify({ revision: settings.revision, categories, accounts: accounts.map(({ opening, ...a }) => ({ ...a, openingCents: toCents(opening) })) }) }, storeId); onSaved() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) } }
 const setAccount = (i: number, patch: Partial<typeof accounts[number]>) => setAccounts(accounts.map((a, j) => j === i ? { ...a, ...patch } : a))
 const setCategory = (i: number, patch: Partial<Category>) => setCategories(categories.map((c, j) => j === i ? { ...c, ...patch } : c))
 return <>
  <section className="admin-card"><div className="admin-toolbar"><h2>Contas bancárias e caixas</h2><button className="admin-secondary" onClick={() => setAccounts([...accounts, { id: '', name: '', kind: 'checking', bank: '', openingCents: 0, openingDate: today(), active: true, opening: '0,00' }])}><Plus size={16} /> Nova conta</button></div>
   <div className="admin-table-wrap"><table className="admin-table dn-edit-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Banco</th><th>Saldo inicial (R$)</th><th>Data do saldo</th><th>Ativa</th></tr></thead><tbody>{accounts.map((a, i) => <tr key={a.id || 'new' + i}><td><input aria-label="Nome da conta" value={a.name} placeholder="Ex.: Itaú PJ" onChange={e => setAccount(i, { name: e.target.value })} /></td><td><select aria-label="Tipo" value={a.kind} onChange={e => setAccount(i, { kind: e.target.value as Account['kind'] })}>{Object.entries(ACCOUNT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td><td><input aria-label="Banco" value={a.bank || ''} onChange={e => setAccount(i, { bank: e.target.value })} /></td><td><input aria-label="Saldo inicial" inputMode="decimal" value={a.opening} onChange={e => setAccount(i, { opening: e.target.value })} /></td><td><input aria-label="Data do saldo" type="date" value={a.openingDate} onChange={e => setAccount(i, { openingDate: e.target.value })} /></td><td><input aria-label="Conta ativa" type="checkbox" className="dn-checkbox" checked={a.active} onChange={e => setAccount(i, { active: e.target.checked })} />{!a.id && <button className="admin-text-button" aria-label="Remover conta" onClick={() => setAccounts(accounts.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td></tr>)}</tbody></table></div></section>
  <section className="admin-card"><div className="admin-toolbar"><h2>Categorias</h2><button className="admin-secondary" onClick={() => setCategories([...categories, { id: '', name: '', direction: 'expense', active: true, system: false }])}><Plus size={16} /> Nova categoria</button></div>
   <div className="dn-grid-2 dn-pad">{(['income', 'expense'] as const).map(d => <div key={d}><h3 className={d === 'income' ? 'dn-in' : 'dn-out'}>{d === 'income' ? 'Receitas' : 'Despesas'}</h3><ul className="dn-cats">{categories.map((c, i) => c.direction === d || (!c.id && !c.system && c.direction === d) ? <li key={c.id || 'new' + i}><input aria-label="Nome da categoria" value={c.name} placeholder="Nome" onChange={e => setCategory(i, { name: e.target.value })} />{!c.system && !c.id && <select aria-label="Tipo" value={c.direction} onChange={e => setCategory(i, { direction: e.target.value as Category['direction'] })}><option value="income">Receita</option><option value="expense">Despesa</option></select>}<label className="dn-toggle"><input type="checkbox" checked={c.active} onChange={e => setCategory(i, { active: e.target.checked })} /> ativa</label>{c.system && <small>padrão</small>}</li> : null)}</ul></div>)}</div></section>
  {error && <Notice>{error}</Notice>}
  <div className="admin-section-actions"><span>Contas com movimentos não podem ser removidas, apenas desativadas.</span><button className="admin-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar contas e categorias'}</button></div>
 </>
}
