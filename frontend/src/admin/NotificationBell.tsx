import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Camera, Mail, MessageCircle } from 'lucide-react'
import { request } from './api'
import type { Destination } from './Navigation'

type Item = { id: string; type: 'lead' | 'appraisal'; title: string; body: string; phone: string; screen: string; created: string; unread: boolean; emailed: boolean }
type Feed = { items: Item[]; unread: number; email: boolean }

const POLL_MS = 60_000
const TARGET: Record<string, Destination> = {
  crm: { screen: 'crm', view: 'all', label: 'Funil de oportunidades' },
  appraisals: { screen: 'appraisals', view: 'all', label: 'Avaliações de usados' },
}
const when = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 1440) return `há ${Math.round(min / 60)} h`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

/** Sininho da retaguarda: leads do site e pedidos de avaliação, com alerta opcional do navegador. */
export default function NotificationBell({ storeId, onNavigate }: { storeId: string; onNavigate: (d: Destination) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(canNotify() ? Notification.permission : 'denied')
  const known = useRef<Set<string> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const next = await request<Feed>('/api/admin/notifications', {}, storeId)
      // Alerta do navegador só para avisos que chegaram depois que a retaguarda abriu
      if (known.current && canNotify() && Notification.permission === 'granted')
        for (const n of next.items.filter((i) => i.unread && !known.current!.has(i.id)).reverse())
          new Notification(n.title, { body: n.body, tag: n.id, icon: '/brand/mark-dark.png' })
      known.current = new Set(next.items.map((i) => i.id))
      setFeed(next)
    } catch {
      /* sem conexão: tenta de novo no próximo ciclo */
    }
  }, [storeId])

  useEffect(() => {
    known.current = null
    void load()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  // Número de novidades no título da aba
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = feed?.unread ? `(${feed.unread}) ${base}` : base
  }, [feed?.unread])

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && feed?.unread) {
      try {
        await request('/api/admin/notifications/seen', { method: 'POST', body: '{}' }, storeId)
        // Mantém o destaque dos novos enquanto a lista está aberta; o contador zera
        setFeed((f) => f && { ...f, unread: 0 })
      } catch { /* tenta de novo na próxima abertura */ }
    }
  }

  const enableAlerts = async () => {
    if (!canNotify()) return
    setPermission(await Notification.requestPermission())
  }

  const unread = feed?.unread || 0
  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-button" aria-label={unread ? `${unread} aviso(s) novo(s)` : 'Avisos'} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        {unread ? <BellRing size={19} /> : <Bell size={19} />}
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Avisos">
          <header>
            <strong>Avisos</strong>
            {feed?.email ? <small><Mail size={12} /> também por e-mail</small> : <small>só no painel</small>}
          </header>
          {canNotify() && permission !== 'granted' && (
            <button type="button" className="bell-enable" onClick={enableAlerts} disabled={permission === 'denied'}>
              <BellRing size={14} /> {permission === 'denied' ? 'Alertas bloqueados no navegador' : 'Ativar alerta no navegador'}
            </button>
          )}
          {!feed?.items.length ? (
            <p className="bell-empty">Nenhum aviso ainda. Contatos e avaliações enviados pelo site aparecem aqui.</p>
          ) : (
            <ul>
              {feed.items.map((n) => (
                <li key={n.id} className={n.unread ? 'unread' : ''}>
                  <button type="button" onClick={() => { setOpen(false); onNavigate(TARGET[n.screen] || TARGET.crm) }}>
                    <span className="bell-icon">{n.type === 'appraisal' ? <Camera size={15} /> : <MessageCircle size={15} />}</span>
                    <span className="bell-text"><strong>{n.title}</strong><small>{n.body}</small><em>{when(n.created)}</em></span>
                  </button>
                  {n.phone && <a className="bell-wa" href={`https://wa.me/55${n.phone}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
