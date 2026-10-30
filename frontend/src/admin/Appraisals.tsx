import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Camera, ExternalLink, Gauge, RefreshCw, Save, Video } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { WhatsAppIcon } from '@/components/ui/Button'
import { APPRAISAL_STATUS, fileUrl, request, type Appraisal } from './api'

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const phone = (d: string) => (d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d)
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Appraisals({ storeId, view }: { storeId: string; view: string }) {
  const [items, setItems] = useState<Appraisal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [open, setOpen] = useState<Appraisal | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    request<Appraisal[]>('/api/admin/appraisals', {}, storeId)
      .then((r) => active && (setItems(r), setError('')))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar as avaliações.'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [storeId, reload])

  const visible = useMemo(() => items.filter((a) => view === 'all' || (view === 'open' ? ['new', 'analyzing'].includes(a.status) : a.status === view)), [items, view])
  const waiting = items.filter((a) => a.status === 'new').length

  return (
    <>
      {error && <div className="admin-notice" role="alert">{error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></div>}
      <div className="admin-section-actions">
        <span>{waiting ? `${waiting} avaliação(ões) aguardando resposta` : 'Pedidos de avaliação enviados pelo site'}</span>
        <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
      </div>
      {!loading && !visible.length ? (
        <section className="admin-card"><div className="admin-empty"><Camera size={32} /><h3>Nenhuma avaliação por aqui</h3><p>Quando um cliente pedir avaliação pelo site, com fotos e vídeo, ela aparece nesta lista e no funil.</p></div></section>
      ) : (
        <ul className="appraisal-grid">
          {visible.map((a) => {
            const cover = a.media.find((m) => m.kind === 'photo')
            const photos = a.media.filter((m) => m.kind === 'photo').length
            return (
              <li key={a.id}>
                <button type="button" className="appraisal-card" onClick={() => setOpen(a)}>
                  <span className="appraisal-cover">{cover && <img src={fileUrl(cover.name)} alt="" loading="lazy" />}<em className={`appraisal-status ${a.status}`}>{APPRAISAL_STATUS[a.status]}</em></span>
                  <span className="appraisal-body">
                    <strong>{a.model} {a.year}</strong>
                    <small>{a.name} · {phone(a.phone)}</small>
                    <small className="appraisal-meta">
                      {a.mileage !== null && <><Gauge size={13} /> {a.mileage.toLocaleString('pt-BR')} km · </>}
                      <Camera size={13} /> {photos}{a.media.some((m) => m.kind === 'video') && <> · <Video size={13} /> vídeo</>}
                    </small>
                    <small>{a.offerCents ? `Proposta: ${money(a.offerCents)}` : `Recebida ${when(a.createdAt)}`}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && <AppraisalDialog appraisal={open} storeId={storeId} onClose={() => setOpen(null)} onSaved={(a) => { setItems((all) => all.map((x) => (x.id === a.id ? a : x))); setOpen(a) }} />}
    </>
  )
}

function AppraisalDialog({ appraisal, storeId, onClose, onSaved }: { appraisal: Appraisal; storeId: string; onClose: () => void; onSaved: (a: Appraisal) => void }) {
  const [status, setStatus] = useState(appraisal.status)
  const [offer, setOffer] = useState(appraisal.offerCents ? String(appraisal.offerCents / 100) : '')
  const [notes, setNotes] = useState(appraisal.internalNotes)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const photos = appraisal.media.filter((m) => m.kind === 'photo')
  const video = appraisal.media.find((m) => m.kind === 'video')
  const offerCents = offer.trim() ? Math.round(Number(offer.replace(/\./g, '').replace(',', '.')) * 100) : null
  const whatsapp = `https://wa.me/55${appraisal.phone}?text=${encodeURIComponent(`Olá, ${appraisal.name.split(' ')[0]}! Avaliamos o seu ${appraisal.model} ${appraisal.year}${offerCents ? ` e nossa proposta é de ${money(offerCents)}` : ''}. Podemos conversar?`)}`

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (offerCents !== null && (!Number.isFinite(offerCents) || offerCents <= 0)) return setMessage('Valor da proposta inválido.')
    setBusy(true)
    setMessage('')
    try {
      onSaved(await request<Appraisal>(`/api/admin/appraisals/${appraisal.id}`, { method: 'PUT', body: JSON.stringify({ revision: appraisal.revision, status, offerCents, internalNotes: notes }) }, storeId))
      setMessage('Avaliação salva.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${appraisal.model} ${appraisal.year}`} description={`${appraisal.name} · ${phone(appraisal.phone)}${appraisal.mileage !== null ? ` · ${appraisal.mileage.toLocaleString('pt-BR')} km` : ''}`} className="admin-root admin-dialog max-w-4xl">
      <div className="appraisal-detail">
        <div className="appraisal-media">
          {video && <video className="appraisal-video" src={fileUrl(video.name)} controls preload="metadata" playsInline />}
          <ul className="appraisal-gallery">
            {photos.map((p, i) => (
              <li key={p.name}><a href={fileUrl(p.name)} target="_blank" rel="noreferrer" aria-label={`Abrir foto ${i + 1} em tamanho real`}><img src={fileUrl(p.name)} alt={`Foto ${i + 1}`} loading="lazy" /><ExternalLink size={14} /></a></li>
            ))}
          </ul>
          {appraisal.notes && <p className="appraisal-notes"><strong>Observações do cliente:</strong> {appraisal.notes}</p>}
        </div>
        <form className="appraisal-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <label className="admin-field"><span>Situação</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as Appraisal['status'])}>{Object.entries(APPRAISAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="admin-field"><span>Proposta (R$)</span>
              <input inputMode="decimal" placeholder="Ex.: 85.000" value={offer} onChange={(e) => setOffer(e.target.value.replace(/[^\d.,]/g, ''))} />
            </label>
            <label className="admin-field"><span>Anotações internas</span>
              <textarea rows={5} maxLength={3000} placeholder="Estado dos pneus, reparos necessários, consulta FIPE…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {message && <p className="admin-notice" role="status">{message}</p>}
            <button className="admin-primary"><Save size={16} /> {busy ? 'Salvando…' : 'Salvar avaliação'}</button>
            <a className="admin-secondary" href={whatsapp} target="_blank" rel="noreferrer"><WhatsAppIcon className="h-4 w-4" /> {offerCents ? 'Enviar proposta no WhatsApp' : 'Falar no WhatsApp'}</a>
          </fieldset>
        </form>
      </div>
    </Dialog>
  )
}
