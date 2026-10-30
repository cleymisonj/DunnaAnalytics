import test from 'node:test'
import assert from 'node:assert/strict'
import { originAllowed } from './api.mjs'

test('aceita a mesma origem e só os domínios do front configurados', () => {
  const previous = process.env.DUNNA_ALLOWED_ORIGINS
  try {
    delete process.env.DUNNA_ALLOWED_ORIGINS
    assert.equal(originAllowed('https://api.aeromotors.com.br', 'api.aeromotors.com.br'), true)
    assert.equal(originAllowed('https://aeromotors.com.br', 'api.aeromotors.com.br'), false)

    process.env.DUNNA_ALLOWED_ORIGINS = ' https://aeromotors.com.br/ , https://aero.vercel.app'
    assert.equal(originAllowed('https://aeromotors.com.br', 'api.aeromotors.com.br'), true)
    assert.equal(originAllowed('https://aero.vercel.app', 'api.aeromotors.com.br'), true)
    // Mesmo domínio em outro protocolo ou porta não é a mesma origem
    assert.equal(originAllowed('http://aeromotors.com.br', 'api.aeromotors.com.br'), false)
    assert.equal(originAllowed('https://aeromotors.com.br:8443', 'api.aeromotors.com.br'), false)
    assert.equal(originAllowed('https://evil.com', 'api.aeromotors.com.br'), false)
    assert.equal(originAllowed('null', 'api.aeromotors.com.br'), false)
  } finally {
    if (previous === undefined) delete process.env.DUNNA_ALLOWED_ORIGINS
    else process.env.DUNNA_ALLOWED_ORIGINS = previous
  }
})
