import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
const target=process.env.DUNNA_BACKEND_URL||'http://127.0.0.1:3001'
export default defineConfig({plugins:[react()],server:{port:5174,proxy:{'/api':{target},'/uploads':{target}}},preview:{proxy:{'/api':{target},'/uploads':{target}}},resolve:{alias:{'@':path.resolve(__dirname,'src')}}})
