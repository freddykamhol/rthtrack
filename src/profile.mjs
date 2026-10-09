// Remember only the profile credential; settings remain on the server.
export function profileToken({ location, history, document, crypto } = globalThis) {
  const params = new URLSearchParams(location.hash.slice(1))
  const valid = (value) => /^[a-f0-9]{64}$/.test(value || '')
  let token = params.get('profile')
  if (!valid(token)) {
    token = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('rthtrack_profile='))?.slice('rthtrack_profile='.length)
  }
  if (!valid(token)) token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  params.set('profile', token)
  history.replaceState(null, '', '#' + params.toString())
  document.cookie = `rthtrack_profile=${token}; Path=/; Max-Age=31536000; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`
  return token
}
