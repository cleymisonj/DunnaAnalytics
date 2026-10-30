import type { Config } from 'tailwindcss'

/**
 * Minha loja — tema claro: fundo cinza-claro, cards brancos com sombra suave,
 * tinta grafite e o vermelho da marca só na ação principal e em estados ativos.
 * Os nomes dos tokens vêm do tema escuro anterior; os valores agora são claros.
 */
export default {
  // relative: caminhos a partir deste arquivo, não do cwd (a raiz roda o Vite com cwd diferente)
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  // hover: só em dispositivos com mouse — evita "hover preso" no toque
  future: { hoverOnlyWhenSupported: true },
  theme: {
    container: { center: true, padding: { DEFAULT: '1rem', lg: '2rem' }, screens: { '2xl': '1360px' } },
    extend: {
      colors: {
        carbon: '#F4F5F7', // fundo da página
        slate: { DEFAULT: '#FFFFFF', raised: '#EEF1F4' }, // card branco e degrau cinza
        ink: { DEFAULT: '#11151C', muted: '#5C6573' }, // grafite e cinza (≥ 4.5:1 sobre o fundo)
        racing: { DEFAULT: '#D3161E', hover: '#B21219' }, // vermelho da logo; branco sobre ele ≥ 4.5:1
        paper: { DEFAULT: '#11151C', ink: '#F4F5F7', muted: '#A9B1BD' }, // recibo escuro sobre a página clara
        night: '#0E1116', // rodapé escuro, onde a logo prata aparece
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['Montserrat', 'system-ui', 'sans-serif'],
      },
      // Cinco degraus de tipo (small, body, lead, head, display)
      fontSize: {
        small: ['clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem)', { lineHeight: '1.45' }],
        body: ['clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem)', { lineHeight: '1.55' }],
        lead: ['clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem)', { lineHeight: '1.3' }],
        head: ['clamp(1.85rem, 1.2rem + 2.2vw, 3rem)', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
        display: ['clamp(2.4rem, 1.5rem + 3vw, 4rem)', { lineHeight: '1.06', letterSpacing: '-0.02em' }],
      },
      // Um raio só para painéis, fotos, botões e campos
      borderRadius: { panel: '3px' },
      boxShadow: {
        float: '0 24px 60px -20px rgba(16,24,40,.35)', // o que flutua: menus, diálogos
        card: '0 1px 2px rgba(16,24,40,.05), 0 10px 28px -12px rgba(16,24,40,.14)', // cards brancos
        lift: '0 2px 4px rgba(16,24,40,.06), 0 18px 40px -14px rgba(16,24,40,.22)', // card no hover
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in .2s ease-out' },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.23, 1, 0.32, 1)',
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
