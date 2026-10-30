import { AlarmClock, CalendarClock, CalendarDays } from 'lucide-react'
import type { Lead, User } from './api'

/** Motivos comuns de perda (o campo também aceita texto livre). */
export const LOSS_REASONS = ['Comprou em outra loja', 'Preço acima do esperado', 'Financiamento não aprovado', 'Desistiu da compra', 'Sem retorno do cliente', 'Carro de interesse foi vendido']

const DAY = 24 * 3600 * 1000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** ISO → valor do <input type="datetime-local"> no fuso local. */
export const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '')

/** Sugestões rápidas: sempre às 10h do dia escolhido. */
export const quickDate = (days: number) => {
  const d = startOfDay(new Date(Date.now() + days * DAY))
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'
export function dueState(iso: string | undefined, now = new Date()): DueState | null {
  if (!iso) return null
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return null
  if (when.getTime() < now.getTime()) return 'overdue'
  const day = startOfDay(when).getTime(), today = startOfDay(now).getTime()
  if (day === today) return 'today'
  if (day - today <= 7 * DAY) return 'soon'
  return 'later'
}

export const formatDue = (iso: string) => {
  const d = new Date(iso)
  const state = dueState(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (state === 'today') return `Hoje, ${time}`
  if (state === 'overdue' && startOfDay(d).getTime() === startOfDay(new Date()).getTime()) return `Hoje, ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${time}`
}

/** Selo de data no card do funil. */
export function DueBadge({ iso }: { iso?: string }) {
  const state = dueState(iso)
  if (!state || !iso) return null
  return (
    <em className={`admin-due ${state}`}>
      <AlarmClock size={12} /> {state === 'overdue' ? 'Atrasado · ' : ''}
      {formatDue(iso)}
    </em>
  )
}

type PanelProps = { leads: Lead[]; users: User[]; user: User; onOpen: (lead: Lead) => void }

/** Painel do CRM: retornos atrasados, de hoje e dos próximos 7 dias. */
export function FollowUpPanel({ leads, users, user, onOpen }: PanelProps) {
  const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost' && l.nextContactAt)
  const sorted = [...open].sort((a, b) => a.nextContactAt!.localeCompare(b.nextContactAt!))
  const groups = [
    { key: 'overdue', title: 'Atrasados', icon: AlarmClock, items: sorted.filter((l) => dueState(l.nextContactAt) === 'overdue') },
    { key: 'today', title: 'Hoje', icon: CalendarClock, items: sorted.filter((l) => dueState(l.nextContactAt) === 'today') },
    { key: 'soon', title: 'Próximos 7 dias', icon: CalendarDays, items: sorted.filter((l) => dueState(l.nextContactAt) === 'soon') },
  ]
  const owner = (l: Lead) => users.find((u) => u.id === l.assignedTo)?.name || (l.assignedTo === user.id ? user.name : 'Sem responsável')
  const withoutDate = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost' && !l.nextContactAt).length

  return (
    <section className="admin-followups" aria-label="Retornos agendados">
      {groups.map(({ key, title, icon: Icon, items }) => (
        <div key={key} className={`admin-followup-group ${key}`}>
          <h3>
            <Icon size={15} /> {title} <span>{items.length}</span>
          </h3>
          {items.length === 0 ? (
            <p className="admin-lane-empty">Nada por aqui</p>
          ) : (
            items.slice(0, 6).map((l) => (
              <button key={l.id} type="button" className="admin-followup-item" onClick={() => onOpen(l)}>
                <strong>{l.name}</strong>
                <small>
                  {formatDue(l.nextContactAt!)} · {owner(l)}
                </small>
              </button>
            ))
          )}
          {items.length > 6 && <p className="admin-followup-more">+{items.length - 6} no funil</p>}
        </div>
      ))}
      {withoutDate > 0 && (
        <p className="admin-followup-hint">
          {withoutDate} interessado{withoutDate > 1 ? 's' : ''} em andamento sem próximo contato agendado.
        </p>
      )}
    </section>
  )
}
