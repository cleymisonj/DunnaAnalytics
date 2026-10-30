export type Role = 'platform' | 'admin' | 'seller'
export type User = { id: string; name: string; email: string; role: Role; storeId: string; active?: number }
export type Store = { id: string; slug: string; name: string; phone: string; city: string }
export type Lead = { id: string; name: string; phone: string; interest: string; source: string; stage: string; assignedTo: string; revision: number; history: {id: string; text: string; author: string; at: string}[]; createdAt?: string; nextContactAt?: string; lossReason?: string }
export async function request<T>(route: string, options: RequestInit = {}, storeId = ''): Promise<T> {
  const response = await fetch(route, { ...options, credentials: 'same-origin', headers: { 'X-Dunna-Request': '1', ...(storeId ? { 'X-Store-Id': storeId } : {}), ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
  const result = await response.json().catch(() => ({error:'Resposta inválida do servidor.'}))
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.')
  return result as T
}
export const STATUS = { available: 'Disponível', reserved: 'Reservado', sold: 'Vendido', draft: 'Rascunho' } as const
export const STAGES: Record<string, string> = { new:'Novo interessado', contact:'Em atendimento', qualified:'Qualificado', proposal:'Proposta', won:'Venda concluída', lost:'Não avançou' }
export const BRANDS = ['Hyundai','Toyota','Honda','Renault','Ford','Suzuki','Fiat','Volkswagen','BYD','Geely','Nissan','Chevrolet','Outra']

export type Media = { name: string; kind: 'photo' | 'video' | 'document' }
export type Appraisal = { id: string; revision: number; name: string; phone: string; model: string; year: number; mileage: number | null; notes: string; media: Media[]; status: 'new' | 'analyzing' | 'offer' | 'accepted' | 'declined'; offerCents: number | null; internalNotes: string; leadId: string; createdAt: string; updatedAt: string }
export const APPRAISAL_STATUS: Record<Appraisal['status'], string> = { new: 'Nova', analyzing: 'Em análise', offer: 'Proposta enviada', accepted: 'Aceita', declined: 'Recusada' }

/** Endereço autenticado de um arquivo privado (mídia de avaliação ou documento de contrato). */
export const fileUrl = (name: string) => `/api/admin/files/${name}`

/** Envia documentos (PDF ou imagem) do contrato: pede o link de envio e manda o arquivo direto para o armazenamento. */
export async function uploadDocuments(files: File[], storeId: string): Promise<string[]> {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  if (files.some((f) => !allowed.includes(f.type))) throw new Error('Envie PDF, JPG, PNG ou WebP.')
  if (files.some((f) => f.size > 10 * 1024 * 1024)) throw new Error('Cada arquivo pode ter até 10 MB.')
  const issued = await request<{ name: string; upload: { url: string; method: string; headers: Record<string, string> } }[]>('/api/admin/contracts/uploads', { method: 'POST', body: JSON.stringify({ files: files.map((f) => ({ kind: 'document', type: f.type, size: f.size })) }) }, storeId)
  await Promise.all(issued.map(async (item, i) => {
    const r = await fetch(item.upload.url, { method: item.upload.method, headers: item.upload.headers, body: files[i], credentials: item.upload.url.startsWith('/') ? 'same-origin' : 'omit' })
    if (!r.ok) throw new Error('O envio do arquivo falhou. Tente de novo.')
  }))
  return issued.map((i) => i.name)
}
