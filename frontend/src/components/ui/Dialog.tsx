import * as RDialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Esconde o cabeçalho visualmente (mantém título para leitores de tela). */
  hideHeader?: boolean
  className?: string
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, title, description, hideHeader, className, children }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-black/75"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </RDialog.Overlay>
            {/* Container de centralização: clique fora do painel fecha o diálogo */}
            <RDialog.Content
              forceMount
              className="fixed inset-0 z-[70] flex items-end justify-center outline-none sm:items-center sm:p-4"
              onClick={(e) => e.target === e.currentTarget && onOpenChange(false)}
            >
              <motion.div
                initial={{ opacity: 0, y: 40, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.97 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-panel bg-slate shadow-float sm:rounded-panel',
                  className,
                )}
              >
                <div className={hideHeader ? 'sr-only' : 'p-6 pb-2 pr-16'}>
                  <RDialog.Title className="display text-lead text-ink">{title}</RDialog.Title>
                  <RDialog.Description className={description ? 'mt-2 text-body text-ink-muted' : 'sr-only'}>
                    {description ?? title}
                  </RDialog.Description>
                </div>
                <RDialog.Close
                  className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-panel bg-carbon text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-black active:scale-[0.97]"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </RDialog.Close>
                {children}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  )
}
