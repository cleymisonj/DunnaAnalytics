import type { IncomingMessage, ServerResponse } from 'node:http'
export function createApi(options?: {root?:string;dataDir?:string;seed?:unknown[]}): Promise<{handler(req:IncomingMessage,res:ServerResponse,next?:()=>void):Promise<void>;close():void}>
