import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Um formato de botão no site inteiro. O vermelho é só para a ação principal. */
type Variant = 'primary' | 'ink' | 'quiet'
type Size = 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-racing text-white hover:bg-racing-hover',
  ink: 'bg-ink text-carbon hover:bg-white',
  quiet: 'bg-slate-raised text-ink hover:bg-[#232c3b]',
}

const sizes: Record<Size, string> = {
  md: 'h-11 px-5 text-small gap-2',
  lg: 'h-14 px-7 text-body gap-2.5',
}

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', className?: string) =>
  cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-panel font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-racing focus-visible:ring-offset-2 focus-visible:ring-offset-carbon',
    variants[variant],
    sizes[size],
    className,
  )

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button ref={ref} className={buttonClass(variant, size, className)} {...props} />
  ),
)
Button.displayName = 'Button'

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.43 9.43 0 0 1-4.8-1.32l-.35-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 9.43 9.45c0 5.2-4.24 9.44-9.44 9.44zm8.04-17.48A11.3 11.3 0 0 0 12.04.7C5.77.7.67 5.8.67 12.060c0 2 .52 3.96 1.52 5.68L.57 23.7l6.1-1.6a11.33 11.33 0 0 0 5.37 1.37h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.030-1.18-5.890-3.33-8.03z" />
    </svg>
  )
}
