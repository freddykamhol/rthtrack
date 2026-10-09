import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { profileToken } from '../src/profile.mjs'

function browser(hash = '', cookie = '') {
  const location = { hash, protocol: 'https:' }
  const document = { cookie }
  return { location, document, crypto: webcrypto, history: { replaceState(_state, _unused, value) { location.hash = value } } }
}

test('reopening the root URL retains the profile and explicit links take precedence', () => {
  const first = browser()
  const token = profileToken(first)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.match(first.document.cookie, /Max-Age=31536000; SameSite=Strict; Secure/)
  const reopened = browser('', first.document.cookie)
  assert.equal(profileToken(reopened), token)
  assert.equal(reopened.location.hash, '#profile=' + token)
  const other = 'a'.repeat(64)
  assert.equal(profileToken(browser('#profile=' + other, first.document.cookie)), other)
})

test('invalid profile links and cookies are replaced; unrelated hash parameters survive', () => {
  const env = browser('#profile=invalid&view=map', 'other=1; rthtrack_profile=invalid')
  const token = profileToken(env)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.equal(new URLSearchParams(env.location.hash.slice(1)).get('view'), 'map')
  assert.equal(profileToken(env), token)
})
