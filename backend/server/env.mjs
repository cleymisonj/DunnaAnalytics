import {existsSync} from 'node:fs'
import {loadEnvFile} from 'node:process'
import path from 'node:path'
import {backendRoot,repositoryRoot} from './paths.mjs'
for(const root of [backendRoot,repositoryRoot]){const file=path.join(root,'.env');if(existsSync(file))loadEnvFile(file)}
