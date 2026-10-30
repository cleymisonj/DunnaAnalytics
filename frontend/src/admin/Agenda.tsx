import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, Plus, ArrowRight, Flag } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { request, type User, type Lead } from './api'
import type { Destination } from './Navigation'
import { Field, Notice, messageOf, money, useResource } from './kit'

export type TaskLink = { kind: 'vehicle' | 'person' | 'lead' | 'deal'; id: string; label: string }
export type Task = { id: string; revision: number; title: string; notes: string; dueAt: string; priority: 'low' | 'normal' | 'high'; assignedTo: string; link: TaskLink | null; status: 'open' | 'done' | 'cancelled'; completedAt: string; completedBy: string; createdByName: string }
const PRIORITY = { high: 'Alta', normal: 'Normal', low: 'Baixa' }
const LINK_KIND = { vehicle: 'Veículo', lead: 'Interessado', person: 'Pessoa', deal: 'Negociação' }
const DAY = 86400000
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const toLocal = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const LINK_TARGET: Record<TaskLink['kind'], Destination> = { vehicle: { screen: 'stock', view: 'all', label: 'Todo o estoque' }, lead: { screen: 'crm', view: 'all', label: 'Funil de oportunidades' }, person: { screen: 'people', view: 'all', label: 'Todos os cadastros' }, deal: { screen: 'deals', view: 'all', label: 'Todas as negociações' } }

export default function Agenda({ storeId, user, users, view, focus, onNavigate }: { storeId: string; user: User; users: User[]; view: string; focus?: string; onNavigate: (d: Destination) => void }) {
 const { data, error, reload } = useResource<Task[]>('/api/admin/tasks', storeId)
 const [editing, setEditing] = useState<Task | null>(null), [failure, setFailure] = useState(''), [owner, setOwner] = useState(view === 'mine' ? user.id : '')
 useEffect(() => { if (focus && data) { const t = data.find(t => t.id === focus); if (t) setEditing(t) } }, [focus, data])
 const name = (id: string) => users.find(u => u.id === id)?.name || (id === user.id ? user.name : 'Equipe')
 const blank = (): Task => ({ id: '', revision: 0, title: '', notes: '', dueAt: new Date(startOfDay() + DAY + 9 * 3600000).toISOString(), priority: 'normal', assignedTo: user.id, link: null, status: 'open', completedAt: '', completedBy: '', createdByName: user.name })
 const toggle = async (t: Task) => { setFailure(''); try { await request(`/api/admin/tasks/${t.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: t.status === 'done' ? 'open' : 'done', revision: t.revision }) }, storeId); reload() } catch (e) { setFailure(messageOf(e)) } }
 const tasks = (data || []).filter(t => !owner || t.assignedTo === owner)
 const open = tasks.filter(t => t.status === 'open').sort((a, b) => a.dueAt.localeCompare(b.dueAt))
 const sod = startOfDay(), now = Date.now()
 const groups = view === 'done'
  ? [{ key: 'done', label: 'Concluídas', tone: 'done', items: tasks.filter(t => t.status === 'done').sort((a, b) => b.completedAt.localeCompare(a.completedAt)) }]
  : [
   { key: 'late', label: 'Atrasadas', tone: 'late', items: open.filter(t => Date.parse(t.dueAt) < now) },
   { key: 'today', label: 'Hoje', tone: 'today', items: open.filter(t => Date.parse(t.dueAt) >= now && Date.parse(t.dueAt) < sod + DAY) },
   { key: 'tomorrow', label: 'Amanhã', tone: '', items: open.filter(t => Date.parse(t.dueAt) >= sod + DAY && Date.parse(t.dueAt) < sod + 2 * DAY) },
   { key: 'week', label: 'Próximos 7 dias', tone: '', items: open.filter(t => Date.parse(t.dueAt) >= sod + 2 * DAY && Date.parse(t.dueAt) < sod + 8 * DAY) },
   { key: 'later', label: 'Mais adiante', tone: '', items: open.filter(t => Date.parse(t.dueAt) >= sod + 8 * DAY) },
  ]
 if (error) return <Notice>{error}</Notice>
 if (!data) return <div className="admin-empty">Carregando agenda…</div>
 return <>
  <div className="admin-stats">{[['Atrasadas', groups[0]?.key === 'late' ? groups[0].items.length : open.filter(t => Date.parse(t.dueAt) < now).length, 'Precisam de atenção agora'], ['Para hoje', open.filter(t => Date.parse(t.dueAt) >= now && Date.parse(t.dueAt) < sod + DAY).length, 'Ainda dentro do prazo'], ['Abertas', open.length, 'Todas as tarefas em aberto'], ['Concluídas (7 dias)', tasks.filter(t => t.status === 'done' && Date.parse(t.completedAt) > now - 7 * DAY).length, 'Ritmo da equipe']].map(([l, n, s]) => <div key={l as string}><span>{l}</span><strong>{n}</strong><small>{s}</small></div>)}</div>
  <section className="admin-card"><div className="admin-toolbar"><h2>{view === 'done' ? 'Tarefas concluídas' : 'Agenda da loja'}</h2>{user.role !== 'seller' && <select aria-label="Responsável" value={owner} onChange={e => setOwner(e.target.value)}><option value="">Toda a equipe</option>{users.filter(u => u.active !== 0).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}<button className="admin-primary" onClick={() => setEditing(blank())}><Plus size={17} /> Nova tarefa</button></div>
   {failure && <Notice>{failure}</Notice>}
   <div className="dn-agenda">{groups.map(g => <section key={g.key} className={`dn-agenda-group ${g.tone}`}><h3>{g.tone === 'late' && <AlertTriangle size={15} />}{g.label}<span>{g.items.length}</span></h3>{g.items.length ? g.items.map(t => <article key={t.id} className={`dn-task ${t.status}`}>
    <button className="dn-check" aria-label={t.status === 'done' ? `Reabrir ${t.title}` : `Concluir ${t.title}`} onClick={() => toggle(t)}>{t.status === 'done' ? <CheckCircle2 size={20} /> : <Circle size={20} />}</button>
    <button className="dn-task-body" onClick={() => setEditing(t)}><strong>{t.title}</strong><small><CalendarClock size={12} /> {when(t.dueAt)} · {name(t.assignedTo)}{t.priority !== 'normal' && <em className={`dn-prio ${t.priority}`}><Flag size={11} /> {PRIORITY[t.priority]}</em>}</small>{t.notes && <p>{t.notes}</p>}</button>
    {t.link && <button className="admin-text-button dn-task-link" onClick={() => onNavigate({ ...LINK_TARGET[t.link!.kind], focus: t.link!.kind === 'person' || t.link!.kind === 'deal' ? t.link!.label.split(' · ')[0] : t.link!.id })}>{LINK_KIND[t.link.kind]}: {t.link.label} <ArrowRight size={13} /></button>}
   </article>) : <p className="admin-lane-empty">{g.key === 'late' ? 'Nada atrasado. Ótimo!' : 'Nenhuma tarefa'}</p>}</section>)}</div>
  </section>
  {editing && <TaskEditor initial={editing} storeId={storeId} user={user} users={users} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
 </>
}

function TaskEditor({ initial, storeId, user, users, onClose, onSaved }: { initial: Task; storeId: string; user: User; users: User[]; onClose: () => void; onSaved: () => void }) {
 const [v, setV] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const [kind, setKind] = useState<TaskLink['kind'] | ''>(initial.link?.kind || ''), [options, setOptions] = useState<{ id: string; label: string }[]>([])
 const admin = user.role !== 'seller'
 useEffect(() => {
  if (!kind) { setOptions([]); return }
  let active = true
  const route = { vehicle: '/api/admin/stock', lead: '/api/admin/leads', person: '/api/admin/people', deal: '/api/admin/deals' }[kind]
  request<Record<string, any>[]>(route, {}, storeId).then(rows => {
   if (!active) return
   setOptions(rows.map(r => ({ id: r.id, label: kind === 'vehicle' ? `${r.brand} ${r.model} ${r.version} ${r.year}${r.plate ? ' · ' + r.plate : ''}` : kind === 'deal' ? `${r.personName || 'Proposta'} · ${money(r.amountCents)}` : kind === 'lead' ? `${(r as Lead).name} · ${(r as Lead).interest || (r as Lead).phone}` : r.name })))
  }).catch(() => setOptions([]))
  return () => { active = false }
 }, [kind, storeId])
 const submit = async (e: FormEvent) => {
  e.preventDefault(); setBusy(true); setError('')
  try { await request(`/api/admin/tasks${v.id ? '/' + v.id : ''}`, { method: v.id ? 'PUT' : 'POST', body: JSON.stringify({ ...v, link: kind && v.link?.id ? { kind, id: v.link.id } : null }) }, storeId); onSaved() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) }
 }
 const quick = (days: number, hour: number) => { const d = new Date(startOfDay() + days * DAY + hour * 3600000); setV({ ...v, dueAt: d.toISOString() }) }
 const linked = useMemo(() => options.some(o => o.id === v.link?.id) || !v.link ? options : [{ id: v.link.id, label: v.link.label }, ...options], [options, v.link])
 return <Dialog open onOpenChange={o => !o && !busy && onClose()} title={v.id ? 'Editar tarefa' : 'Nova tarefa'} description="Defina o que precisa ser feito, quando e por quem." className="admin-root admin-dialog max-w-2xl"><form onSubmit={submit} className="admin-editor"><fieldset disabled={busy}><div className="admin-form-grid">
  <Field label="O que precisa ser feito *" wide><input required maxLength={160} placeholder="Ex.: Ligar para confirmar test drive" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></Field>
  <div className="admin-field wide"><label htmlFor="task-due">Quando *</label><div className="admin-next-contact"><input id="task-due" type="datetime-local" required value={toLocal(v.dueAt)} onChange={e => e.target.value && setV({ ...v, dueAt: new Date(e.target.value).toISOString() })} />{([['Hoje 17h', 0, 17], ['Amanhã 9h', 1, 9], ['Em 3 dias', 3, 9], ['Em 1 semana', 7, 9]] as const).map(([l, d, h]) => <button key={l} type="button" className="admin-chip" onClick={() => quick(d, h)}>{l}</button>)}</div></div>
  <Field label="Prioridade"><select value={v.priority} onChange={e => setV({ ...v, priority: e.target.value as Task['priority'] })}>{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
  {admin ? <Field label="Responsável"><select value={v.assignedTo} onChange={e => setV({ ...v, assignedTo: e.target.value })}>{[user, ...users.filter(u => u.id !== user.id && u.active !== 0)].map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field> : <Field label="Responsável"><input disabled value={user.name} /></Field>}
  <Field label="Vincular a"><select value={kind} onChange={e => { setKind(e.target.value as TaskLink['kind'] | ''); setV({ ...v, link: null }) }}><option value="">Sem vínculo</option>{(admin ? ['vehicle', 'lead', 'person', 'deal'] as const : ['vehicle', 'lead'] as const).map(k => <option key={k} value={k}>{LINK_KIND[k]}</option>)}</select></Field>
  {kind && <Field label={LINK_KIND[kind]}><select required value={v.link?.id || ''} onChange={e => setV({ ...v, link: { kind, id: e.target.value, label: options.find(o => o.id === e.target.value)?.label || '' } })}><option value="">Selecione…</option>{linked.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>}
  <Field label="Observações" wide><textarea rows={3} maxLength={2000} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} /></Field>
 </div></fieldset>{v.id && <p className="dn-muted">Criada por {v.createdByName}{v.status === 'done' && v.completedBy ? ` · concluída por ${v.completedBy} em ${new Date(v.completedAt).toLocaleString('pt-BR')}` : ''}</p>}{error && <Notice>{error}</Notice>}<footer className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose} disabled={busy}>Fechar</button><button className="admin-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar tarefa'}</button></footer></form></Dialog>
}

type PendingItem = { id: string; kind: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; date: string; amountCents?: number; target: Destination }
const KIND_LABEL: Record<string, string> = { task: 'Tarefas', lead: 'Interessados', finance: 'Financeiro', vehicle: 'Estoque', deal: 'Negociações', appraisal: 'Avaliações', contract: 'Contratos' }
const SEVERITY = { high: 'Urgente', medium: 'Atenção', low: 'Melhoria' }

export function Pending({ storeId, onNavigate }: { storeId: string; onNavigate: (d: Destination) => void }) {
 const { data, error } = useResource<{ items: PendingItem[]; counts: Record<string, number> }>('/api/admin/pending', storeId)
 const [kind, setKind] = useState('all')
 if (error) return <Notice>{error}</Notice>
 if (!data) return <div className="admin-empty">Reunindo pendências da loja…</div>
 const kinds = [...new Set(data.items.map(i => i.kind))]
 const items = data.items.filter(i => kind === 'all' || i.kind === kind)
 return <>
  <div className="admin-stats">{(['high', 'medium', 'low'] as const).map(s => <div key={s} className={`dn-sev-card ${s}`}><span>{SEVERITY[s]}</span><strong>{data.counts[s]}</strong><small>{s === 'high' ? 'Atrasos que custam dinheiro ou cliente' : s === 'medium' ? 'Resolva nos próximos dias' : 'Cadastro e organização'}</small></div>)}<div><span>Total</span><strong>{data.counts.total}</strong><small>Itens reunidos de todos os módulos</small></div></div>
  <section className="admin-card"><div className="admin-toolbar"><h2>Central de pendências</h2><div className="dn-chips" role="group" aria-label="Filtrar por área"><button className={`admin-chip ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>Todas</button>{kinds.map(k => <button key={k} className={`admin-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k] || k} · {data.items.filter(i => i.kind === k).length}</button>)}</div></div>
   {items.length ? <ul className="dn-pending">{items.map(i => <li key={i.id} className={i.severity}><span className={`dn-sev ${i.severity}`}>{SEVERITY[i.severity]}</span><div><strong>{i.title}</strong><small>{[KIND_LABEL[i.kind], i.detail, i.amountCents ? money(i.amountCents) : '', i.date ? new Date(i.date.length === 10 ? i.date + 'T12:00:00' : i.date).toLocaleDateString('pt-BR') : ''].filter(Boolean).join(' · ')}</small></div><button className="admin-secondary" onClick={() => onNavigate(i.target)}>Resolver <ArrowRight size={14} /></button></li>)}</ul> : <div className="admin-empty"><CheckCircle2 size={32} /><h3>Tudo em dia</h3><p>Nenhuma pendência nesta área.</p></div>}
  </section>
 </>
}
