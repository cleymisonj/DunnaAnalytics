import { fileURLToPath } from 'node:url'

// Caminho explícito: `npm run dev` na raiz roda o Vite com cwd na raiz do repositório,
// e o Tailwind procuraria a configuração lá (o site ficava em branco).
const config = fileURLToPath(new URL('./tailwind.config.ts', import.meta.url))

export default {
  plugins: { tailwindcss: { config }, autoprefixer: {} },
}
