import http from 'node:http'
import {createApi} from './api.mjs'
import {createCloudApi} from './cloud.mjs'
import {createPhotoStorage} from './photo-storage.mjs'
const api=process.env.DATABASE_URL ? await createCloudApi({storage:createPhotoStorage()}) : await createApi()
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'dunna-backend'}));return}void api.handler(req,res)})
server.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>console.log('Dunna API: porta '+(process.env.PORT||3001)))
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{api.close();process.exit(0)}))
