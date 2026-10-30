import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, Search, Tag as TagIcon, X } from 'lucide-react'
import { request } from './api'
import type { Destination } from './Navigation'
import { Notice, messageOf, useResource } from './kit'

export type Tag = { id: string; revision: number; name: string; color: string; count?: number }
export type TagKind = 'vehicle' | 'person' | 'lead' | 'deal'
export const TAG_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'slate', 'orange']
const COLOR_NAME: Record<string, string> = { indigo: 'Índigo', emerald: 'Verde', amber: 'Âmbar', rose: 'Rosa', sky: 'Azul', violet: 'Violeta', slate: 'Cinza', orange: 'Laranja' }

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
 return <span className={`dn-tag t-${tag.color}`}>{tag.name}{onRemove && <button type="button" aria-label={`Remover etiqueta ${tag.name}`} onClick={onRemove}><X size={11} /></button>}</span>
}

/** Etiquetas de um registro: mostra as aplicadas e permite incluir/remover (salva na hora). */
export function TagPicker({ kind, id, storeId, readOnly = false }: { kind: TagKind; id: string; storeId: string; readOnly?: boolean }) {
 const [tags, setTags] = useState<Tag[]>([]), [applied, setApplied] = useState<string[]>([]), [error, setError] = useState(''), [open, setOpen] = useState(false)
 useEffect(() => { if (!id) return; let active = true; Promise.all([request<Tag[]>('/api/admin/tags', {}, storeId), request<Record<string, string[]>>(`/api/admin/tags/links?kind=${kind}`, {}, storeId)]).then(([t, l]) => { if (active) { setTags(t); setApplied(l[`${kind}:${id}`] || []) } }).catch(e => active && setError(messageOf(e))); return () => { active = false } }, [kind, id, storeId])
 const save = async (next: string[]) => { setError(''); const before = applied; setApplied(next); try { await request('/api/admin/tags/links', { method: 'PUT', body: JSON.stringify({ kind, id, tagIds: next }) }, storeId) } catch (e) { setApplied(before); setError(messageOf(e)) } }
 if (!id) return <p className="dn-muted">Salve o cadastro para aplicar etiquetas.</p>
 const available = tags.filter(t => !applied.includes(t.id))
 return <div className="dn-tagpicker">{applied.map(t => tags.find(x => x.id === t)).filter(Boolean).map(t => <TagChip key={t!.id} tag={t!} onRemove={readOnly ? undefined : () => save(applied.filter(x => x !== t!.id))} />)}
  {!readOnly && <span className="dn-tag-add"><button type="button" className="admin-chip" onClick={() => setOpen(o => !o)}><Plus size={12} /> Etiqueta</button>{open && <span className="dn-tag-menu" role="menu">{available.length ? available.map(t => <button type="button" role="menuitem" key={t.id} onClick={() => { setOpen(false); void save([...applied, t.id]) }}><TagChip tag={t} /></button>) : <small>{tags.length ? 'Todas aplicadas.' : 'Crie etiquetas em Administrativo › Etiquetas.'}</small>}</span>}</span>}
  {!applied.length && readOnly && <small className="dn-muted">Sem etiquetas</small>}{error && <small className="dn-bad">{error}</small>}</div>
}

/** Mapa de etiquetas por registro, para listas (estoque, funil). */
export function useTagMap(kind: TagKind, storeId: string, deps: unknown[] = []) {
 const tags = useResource<Tag[]>('/api/admin/tags', storeId, deps), links = useResource<Record<string, string[]>>(`/api/admin/tags/links?kind=${kind}`, storeId, deps)
 return (id: string) => (links.data?.[`${kind}:${id}`] || []).map(t => tags.data?.find(x => x.id === t)).filter(Boolean) as Tag[]
}

export function TagsManager({ storeId }: { storeId: string }) {
 const { data, error, reload } = useResource<Tag[]>('/api/admin/tags', storeId)
 const [form, setForm] = useState({ id: '', revision: 0, name: '', color: 'indigo' }), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setFailure(''); try { await request(`/api/admin/tags${form.id ? '/' + form.id : ''}`, { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) }, storeId); setForm({ id: '', revision: 0, name: '', color: 'indigo' }); reload() } catch (err) { setFailure(messageOf(err)) } finally { setBusy(false) } }
 const remove = async (t: Tag) => { if (!window.confirm(`Excluir a etiqueta "${t.name}"? Ela sai de ${t.count || 0} registro(s).`)) return; try { await request(`/api/admin/tags/${t.id}`, { method: 'DELETE' }, storeId); reload() } catch (err) { setFailure(messageOf(err)) } }
 if (error) return <Notice>{error}</Notice>
 return <div className="dn-grid-2">
  <section className="admin-card dn-pad"><h2>{form.id ? 'Editar etiqueta' : 'Nova etiqueta'}</h2><form onSubmit={submit} className="dn-tag-form"><label className="admin-field"><span>Nome</span><input required maxLength={40} placeholder="Ex.: VIP, Financiamento, Repasse" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><div className="admin-field"><span>Cor</span><div className="dn-swatches">{TAG_COLORS.map(c => <button type="button" key={c} aria-label={COLOR_NAME[c]} aria-pressed={form.color === c} className={`dn-swatch t-${c} ${form.color === c ? 'on' : ''}`} onClick={() => setForm({ ...form, color: c })} />)}</div></div><p>Prévia: <TagChip tag={{ id: '', revision: 0, name: form.name || 'Etiqueta', color: form.color }} /></p>{failure && <Notice>{failure}</Notice>}<div className="dn-row">{form.id && <button type="button" className="admin-secondary" onClick={() => setForm({ id: '', revision: 0, name: '', color: 'indigo' })}>Cancelar</button>}<button className="admin-primary" disabled={busy}><TagIcon size={15} /> {form.id ? 'Salvar' : 'Criar etiqueta'}</button></div></form></section>
  <section className="admin-card"><div className="admin-toolbar"><h2>Etiquetas da loja</h2></div>{!data ? <div className="admin-empty">Carregando…</div> : data.length ? <ul className="dn-tag-list">{data.map(t => <li key={t.id}><TagChip tag={t} /><small>{t.count || 0} registro(s)</small><button className="admin-text-button" onClick={() => setForm({ id: t.id, revision: t.revision, name: t.name, color: t.color })}>Editar</button><button className="admin-text-button" onClick={() => remove(t)}>Excluir</button></li>)}</ul> : <div className="admin-empty"><TagIcon size={28} /><p>Nenhuma etiqueta. Use etiquetas para organizar veículos, clientes, interessados e negociações — e encontrá-los pela busca.</p></div>}</section>
 </div>
}

type Group = { kind: string; label: string; total: number; items: { id: string; title: string; subtitle: string; target: Destination }[] }
export function GlobalSearch({ storeId, onNavigate }: { storeId: string; onNavigate: (d: Destination) => void }) {
 const [q, setQ] = useState(''), [groups, setGroups] = useState<Group[]>([]), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [active, setActive] = useState(0)
 const input = useRef<HTMLInputElement>(null), box = useRef<HTMLDivElement>(null)
 useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true) } }; const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }; window.addEventListener('keydown', key); window.addEventListener('mousedown', click); return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click) } }, [])
 useEffect(() => { if (q.trim().length < 2) { setGroups([]); return } setBusy(true); const t = setTimeout(() => { request<{ groups: Group[] }>(`/api/admin/search?q=${encodeURIComponent(q)}`, {}, storeId).then(r => { setGroups(r.groups); setActive(0) }).catch(() => setGroups([])).finally(() => setBusy(false)) }, 220); return () => clearTimeout(t) }, [q, storeId])
 const flat = groups.flatMap(g => g.items)
 const go = (d: Destination) => { setOpen(false); setQ(''); onNavigate(d) }
 return <div className="dn-search" ref={box}><Search size={16} /><input ref={input} aria-label="Busca geral" placeholder="Buscar carro, placa, cliente, telefone…" value={q} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) } else if (e.key === 'Enter' && flat[active]) go(flat[active].target); else if (e.key === 'Escape') { setOpen(false); input.current?.blur() } }} /><kbd>Ctrl K</kbd>
  {open && q.trim().length >= 2 && <div className="dn-search-results" role="listbox">{busy && !groups.length ? <p>Buscando…</p> : groups.length ? groups.map(g => <section key={g.kind}><h4>{g.label}{g.total > g.items.length && <span>{g.items.length} de {g.total}</span>}</h4>{g.items.map(i => { const index = flat.indexOf(i); return <button key={g.kind + i.id} role="option" aria-selected={index === active} className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => go(i.target)}><strong>{i.title}</strong><small>{i.subtitle}</small></button> })}</section>) : <p>Nada encontrado para “{q}”.</p>}</div>}
 </div>
}
