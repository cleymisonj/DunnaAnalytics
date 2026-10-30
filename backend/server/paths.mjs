import {fileURLToPath} from 'node:url'
export const backendRoot=fileURLToPath(new URL('../',import.meta.url))
export const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url))
export const frontendRoot=fileURLToPath(new URL('../../frontend/',import.meta.url))
