import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import './map-controls.css'
import { useOwnPosition } from './useOwnPosition'
import { flightEvents } from './flight-events.mjs'
const germanyBounds = L.latLngBounds([47.27, 5.87], [55.06, 15.04])
type Notice = { id: string; flightId: string; title: string; time: number }

type Flight = { id: string; callSign: string; type: 'RTH' | 'ITH' | 'HELI'; model: string; operator: string; status: 'Im Flug' | 'Am Boden'; altitude: string; speed: string; location: string; accent: string; coords: [number, number]; live: boolean }
type PadCategory = 'Wiese' | 'Landeplatz beleuchtet' | 'Krankenhaus' | 'Feuerwehr' | 'Sportplatz' | 'Sonstige'
type LandingPad = { id: string; name: string; category: PadCategory; coords: [number, number]; notes: string; active: boolean }
type PersistedSettings = { districts: string[]; showFlights: boolean; showPads: boolean; showOtherHelis: boolean; notificationsEnabled: boolean; pads: LandingPad[] }
type AdsbAircraft = { hex: string; flight?: string; registration?: string; r?: string; t?: string; category?: string; lat?: number; lon?: number; alt_baro?: number | string; gs?: number; lastPosition?: { lat?: number; lon?: number } }

const defaultPads: LandingPad[] = []
const padCategories: PadCategory[] = ['Wiese', 'Landeplatz beleuchtet', 'Krankenhaus', 'Feuerwehr', 'Sportplatz', 'Sonstige']
const districtGeoJsonUrl = 'https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/4_kreise/3_mittel.geo.json'

function geometryRings(value: unknown): number[][][] {
  if (!Array.isArray(value) || value.length === 0) return []
  if (Array.isArray(value[0]) && typeof value[0][0] === 'number') return [value as number[][]]
  return value.flatMap((child) => geometryRings(child))
}
function districtAdjacency(geojson: { features?: Array<{ properties?: { NAME_3?: string }; geometry?: { coordinates?: unknown } }> }) {
  const owners = new Map<string, Set<string>>()
  geojson.features?.forEach((feature) => {
    const name = feature.properties?.NAME_3
    if (!name) return
    geometryRings(feature.geometry?.coordinates).forEach((ring) => ring.forEach((point, index) => {
      const next = ring[(index + 1) % ring.length]
      const a = `${point[0].toFixed(5)},${point[1].toFixed(5)}`; const b = `${next[0].toFixed(5)},${next[1].toFixed(5)}`
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (!owners.has(key)) owners.set(key, new Set()); owners.get(key)?.add(name)
    }))
  })
  const adjacency = new Map<string, Set<string>>()
  owners.forEach((names) => { const list = [...names]; list.forEach((name) => { if (!adjacency.has(name)) adjacency.set(name, new Set()); list.filter((other) => other !== name).forEach((other) => adjacency.get(name)?.add(other)) }) })
  return adjacency
}

type RescueRegistryEntry = { callsign: string; displayName: string; type: 'RTH' | 'ITH'; operator: string; registrations: string[] }
const germanRescueRegistry: { source: string; callsignPrefixes: string[]; registrations: Set<string>; entries: RescueRegistryEntry[] } = {
  source: 'https://de.ivao.aero/special-operations/luftrettung/',
  callsignPrefixes: ['CHX', 'CHR', 'RTH', 'ITH', 'HEMS', 'RESCUE'],
  registrations: new Set(['D-HXFT', 'D-HLDM', 'D-HXFW']),
  entries: [{ callsign: 'CHXE5', displayName: 'Christoph Europa 5', type: 'RTH', operator: 'DRF Luftrettung', registrations: ['D-HXFW'] }],
}
function findRegistryEntry(callsign: string, registration: string) {
  return germanRescueRegistry.entries.find((entry) => entry.callsign === callsign.toUpperCase() || entry.registrations.includes(registration))
}
function isRegisteredGermanRescue(callsign: string, registration: string) {
  return Boolean(findRegistryEntry(callsign, registration)) || germanRescueRegistry.callsignPrefixes.some((prefix) => callsign.toUpperCase().startsWith(prefix)) || germanRescueRegistry.registrations.has(registration)
}
function fromAdsb(aircraft: AdsbAircraft): Flight | null {
  const callsign = aircraft.flight?.trim() || ''
  const registration = (aircraft.r || aircraft.registration || '').trim().toUpperCase()
  const helicopter = isRegisteredGermanRescue(callsign, registration) || aircraft.category === 'A7' || /^(EC\d|AS\d|BK\d|H1\d\d|R22|R44|R66|B06|B407|A109|A139|S76)/i.test(aircraft.t || '')
  const latitude = aircraft.lat ?? aircraft.lastPosition?.lat
  const longitude = aircraft.lon ?? aircraft.lastPosition?.lon
  if ((!callsign && !registration) || !helicopter || latitude == null || longitude == null) return null
  const registryEntry = findRegistryEntry(callsign, registration)
  const isRegisteredRescue = isRegisteredGermanRescue(callsign, registration)
  const isIth = registryEntry?.type === 'ITH' || /ITH|Hansa/i.test(callsign)
  const classifiedType = registryEntry?.type || (isRegisteredRescue ? (isIth ? 'ITH' : 'RTH') : 'HELI')
  const operator = registryEntry?.operator || (/ADAC/i.test(callsign) ? 'ADAC Luftrettung' : /DRF/i.test(callsign) ? 'DRF Luftrettung' : 'Luftrettung / ADS-B')
  const altitude = typeof aircraft.alt_baro === 'number' ? `${aircraft.alt_baro.toLocaleString('de-DE')} ft` : '--'
  return { id: aircraft.hex, callSign: registryEntry?.displayName || callsign || registration, type: classifiedType, model: aircraft.t || 'Helikopter', operator, status: aircraft.alt_baro === 'ground' ? 'Am Boden' : 'Im Flug', altitude, speed: aircraft.gs == null ? '--' : `${Math.round(aircraft.gs * 1.852)} km/h`, location: registration || 'ADS-B-Position', accent: classifiedType === 'ITH' ? '#9b83ff' : classifiedType === 'RTH' ? '#ff6b4a' : '#56b6ff', coords: [latitude, longitude], live: true }
}

async function fetchLiveFlights(signal: AbortSignal) {
  // The flight feed is intentionally wider than the active district layer:
  // aircraft outside the user's own counties should remain visible too.
  const urls = ['/adsb-live']
  const payloads = (await Promise.all(urls.map(async (url) => { try { const response = await fetch(url, { signal }); return response.ok ? await response.json() as { ac?: AdsbAircraft[] } : null } catch { return null } }))).filter((payload): payload is { ac?: AdsbAircraft[] } => payload !== null)
  if (!payloads.length) throw new Error('ADSB feed unavailable')
  const unique = new Map<string, AdsbAircraft>()
  payloads.flatMap((payload) => payload.ac || []).forEach((aircraft) => unique.set(aircraft.hex, aircraft))
  return [...unique.values()].map(fromAdsb).filter((flight): flight is Flight => flight !== null)
}

function Logo() { return <div className="logo"><span className="logo-mark">✦</span><span>RTH<span>track</span></span></div> }
function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span> }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character) }
const settingsApi = '/api/rthtrack/settings'
function profileToken() {
  const params = new URLSearchParams(location.hash.slice(1))
  let token = params.get('profile') || ''
  if (!/^[a-f0-9]{64}$/.test(token)) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    params.set('profile', token)
    history.replaceState(null, '', '#' + params.toString())
  }
  return token
}
const initialSettings: PersistedSettings = { districts: ['Uelzen', 'Lüneburg', 'Harburg'], showFlights: true, showPads: true, showOtherHelis: false, notificationsEnabled: true, pads: defaultPads }
function isPadCategory(value: unknown): value is PadCategory { return typeof value === 'string' && padCategories.includes(value as PadCategory) }
function readSettings(value: unknown): PersistedSettings {
  if (!value || typeof value !== 'object') return initialSettings
  const input = value as Partial<PersistedSettings>
  return { districts: Array.isArray(input.districts) ? input.districts.filter((item): item is string => typeof item === 'string') : initialSettings.districts, showFlights: input.showFlights !== false, showPads: input.showPads !== false, showOtherHelis: input.showOtherHelis === true, notificationsEnabled: input.notificationsEnabled !== false, pads: Array.isArray(input.pads) ? input.pads.filter((pad): pad is LandingPad => Boolean(pad && typeof pad.id === 'string' && typeof pad.name === 'string' && Array.isArray(pad.coords) && isPadCategory(pad.category))) : defaultPads }
}

function App() {
  const mapRef = useRef<HTMLDivElement>(null); const leafletMap = useRef<L.Map | null>(null); const layersRef = useRef<L.LayerGroup | null>(null); const districtLayerRef = useRef<L.LayerGroup | null>(null)
  const [flights, setFlights] = useState<Flight[]>([]); const [dataMode, setDataMode] = useState<'live' | 'offline'>('offline'); const [selection, setSelectedFlight] = useState<Flight | null>(null); const [showFlights, setShowFlights] = useState(true); const [showPads, setShowPads] = useState(true); const [showOtherHelis, setShowOtherHelis] = useState(false); const [search, setSearch] = useState(''); const [panelOpen, setPanelOpen] = useState(true); const [muted, setMuted] = useState(false); const [showSettings, setShowSettings] = useState(false); const [showNotifications, setShowNotifications] = useState(false); const [notificationsEnabled, setNotificationsEnabled] = useState(true); const [districts, setDistricts] = useState(['Uelzen', 'Lüneburg', 'Harburg']); const [districtInput, setDistrictInput] = useState(''); const [districtNames, setDistrictNames] = useState<string[]>([]); const [pads, setPads] = useState<LandingPad[]>(defaultPads); const [selectedPad, setSelectedPad] = useState<LandingPad | null>(null); const [padDraft, setPadDraft] = useState<LandingPad | null>(null); const [mapMenu, setMapMenu] = useState<{ x: number; y: number; coords: [number, number] } | null>(null); const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'server' | 'saving' | 'error'>('loading'); const [saveError, setSaveError] = useState(''); const [profile] = useState(profileToken); const revision = useRef(0); const saved = useRef(''); const saving = useRef(false)
  const own = useOwnPosition()
  const centerOwn = useRef(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [readAt, setReadAt] = useState(0)
  const [notificationMessage, setNotificationMessage] = useState('')
  const previousFlights = useRef<Flight[] | null>(null)
  const notificationRegistration = useRef<ServiceWorkerRegistration | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const unread = notices.filter((notice) => notice.time > readAt).length
  const enableNotifications = async () => {
    setNotificationsEnabled(true)
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { setNotificationMessage('In-App-Meldungen aktiv. Systemmeldungen werden hier nicht unterstützt.'); return }
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setNotificationMessage('In-App-Meldungen aktiv. Systemmeldungen bitte in den Browser-Einstellungen erlauben.'); return }
      await navigator.serviceWorker.register('/notification-sw.js')
      notificationRegistration.current = await navigator.serviceWorker.ready
      setNotificationMessage('Systemmeldungen aktiviert, solange die App geöffnet ist.')
      if (!audioContext.current) audioContext.current = new AudioContext()
      await audioContext.current.resume()
    } catch { setNotificationMessage('In-App-Meldungen aktiv. Systemmeldungen konnten nicht aktiviert werden.') }
  }
  const processFlightEvents = useEffectEvent((next: Flight[]) => {
    const events = flightEvents(previousFlights.current, next)
    previousFlights.current = next
    if (!notificationsEnabled || !events.length) return
    const now = Date.now()
    setNotices((current) => [...events.map((event, index) => ({ ...event, id: now + '-' + index, time: now })), ...current].slice(0, 50))
    if (!muted && audioContext.current?.state === 'running') {
      const context = audioContext.current; const oscillator = context.createOscillator(); const gain = context.createGain()
      oscillator.frequency.value = 740; gain.gain.setValueAtTime(0.06, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.16)
    }
    if (notificationRegistration.current && Notification.permission === 'granted') {
      void notificationRegistration.current.showNotification('RTHtrack', { body: events.map((event) => event.title).slice(0, 4).join('\n'), tag: 'rthtrack-live', silent: muted }).catch(() => setNotificationMessage('Systemmeldung nicht zustellbar. Meldungen stehen in der Liste.'))
    }
  })
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      let active = true
      void navigator.serviceWorker.register('/notification-sw.js').then(() => navigator.serviceWorker.ready).then((registration) => { if (active) notificationRegistration.current = registration }).catch(() => {})
      return () => { active = false }
    }
  }, [])
  const activeDistricts = useMemo(() => new Set(districts), [districts])
  const addDistrict = () => { const query = districtInput.trim().toLocaleLowerCase('de-DE'); const value = districtNames.find((name) => name.toLocaleLowerCase('de-DE') === query) || districtNames.find((name) => name.toLocaleLowerCase('de-DE').startsWith(query)); if (value && !districts.includes(value) && districts.length < 20) { setDistricts([...districts, value]); setDistrictInput('') } }
  const districtSuggestions = useMemo(() => { const query = districtInput.trim().toLocaleLowerCase('de-DE'); if (!query) return []; return districtNames.filter((name) => name.toLocaleLowerCase('de-DE').startsWith(query) && !districts.includes(name)).slice(0, 6) }, [districtInput, districtNames, districts])
  const filteredFlights = useMemo(() => flights.filter((flight) => (showOtherHelis || flight.type !== 'HELI') && (flight.callSign.toLowerCase().includes(search.toLowerCase()) || flight.location.toLowerCase().includes(search.toLowerCase()))), [flights, search, showOtherHelis])
  const selectedFlight = filteredFlights.find((flight) => flight.id === selection?.id) || filteredFlights[0] || null
  const currentSettings = useMemo(() => ({ districts, showFlights, showPads, showOtherHelis, notificationsEnabled, pads }), [districts, showFlights, showPads, showOtherHelis, notificationsEnabled, pads])

  useEffect(() => {
    let active = true
    fetch(settingsApi, { headers: { 'X-RTHtrack-Profile': profile } }).then(async (response) => {
      if (!response.ok) throw new Error('Server-Speicher nicht erreichbar')
      const body = await response.json()
      if (!active) return
      const incoming = readSettings(body.settings)
      revision.current = body.revision
      saved.current = JSON.stringify(incoming)
      setDistricts(incoming.districts); setShowFlights(incoming.showFlights); setShowPads(incoming.showPads)
      setShowOtherHelis(incoming.showOtherHelis); setNotificationsEnabled(incoming.notificationsEnabled); setPads(incoming.pads)
      setPersistenceStatus('server')
    }).catch((error) => { if (active) { setSaveError(error.message); setPersistenceStatus('error') } })
    return () => { active = false }
  }, [profile])
  useEffect(() => {
    if (persistenceStatus !== 'server' || saved.current === JSON.stringify(currentSettings)) return
    const timer = window.setTimeout(async () => {
      if (saving.current) return
      saving.current = true; setPersistenceStatus('saving')
      try {
        const response = await fetch(settingsApi, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-RTHtrack-Profile': profile }, body: JSON.stringify({ revision: revision.current, settings: currentSettings }) })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Speichern fehlgeschlagen')
        revision.current = body.revision; saved.current = JSON.stringify(currentSettings); setPersistenceStatus('server')
      } catch (error) { setSaveError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen'); setPersistenceStatus('error') }
      finally { saving.current = false }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [currentSettings, persistenceStatus, profile])

  useEffect(() => { let active = true; const controller = new AbortController(); const load = async () => { try { const next = await fetchLiveFlights(controller.signal); if (active) { processFlightEvents(next); setFlights(next); setDataMode('live'); setSelectedFlight((current) => next.find((item) => item.id === current?.id) || null) } } catch { if (active) { previousFlights.current = null; setFlights([]); setSelectedFlight(null); setDataMode('offline') } } }; load(); const timer = window.setInterval(load, 30000); return () => { active = false; controller.abort(); window.clearInterval(timer) } }, [])
  useEffect(() => { if (!mapRef.current || leafletMap.current) return; const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false, minZoom: 6, maxZoom: 18, tapHold: false, maxBounds: germanyBounds, maxBoundsViscosity: 1, worldCopyJump: false, bounceAtZoomLimits: false }).setView([51.1, 10.4], 7); map.createPane('districts'); const pane = map.getPane('districts'); if (pane) pane.style.zIndex = '350'; L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(import.meta.env.VITE_CARTO_API_KEY || '')}`, { maxZoom: 20, noWrap: true, bounds: germanyBounds }).addTo(map); L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('© OpenStreetMap · CARTO · <a href="https://adsb.fi" target="_blank" rel="noreferrer">adsb.fi</a>').addTo(map); leafletMap.current = map; districtLayerRef.current = L.layerGroup().addTo(map); layersRef.current = L.layerGroup().addTo(map); const constrain = () => { map.setMinZoom(Math.max(6, map.getBoundsZoom(germanyBounds, true))); map.panInsideBounds(germanyBounds, { animate: false }) }; constrain(); map.on('resize', constrain); return () => { map.off('resize', constrain); map.remove(); leafletMap.current = null } }, [])
  useEffect(() => {
    const map = leafletMap.current; if (!map) return
    const container = map.getContainer()
    let timer = 0; let start: { x: number; y: number } | null = null; let openedAt = 0
    const cancel = () => { window.clearTimeout(timer); start = null }
    const open = (x: number, y: number) => { const rect = container.getBoundingClientRect(); const point = map.containerPointToLatLng([x - rect.left, y - rect.top]); setMapMenu({ x, y, coords: [point.lat, point.lng] }); openedAt = Date.now() }
    const down = (event: PointerEvent) => { cancel(); if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('.leaflet-marker-icon')) return; start = { x: event.clientX, y: event.clientY }; timer = window.setTimeout(() => { if (start) open(start.x, start.y) }, 650) }
    const move = (event: PointerEvent) => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel() }
    const click = (event: MouseEvent) => { if (Date.now() - openedAt < 800) { event.preventDefault(); event.stopPropagation() } else setMapMenu(null) }
    const menu = (event: L.LeafletMouseEvent) => { L.DomEvent.preventDefault(event.originalEvent); open(event.originalEvent.clientX, event.originalEvent.clientY) }
    map.on('contextmenu', menu); map.on('movestart', cancel)
    container.addEventListener('pointerdown', down); container.addEventListener('pointermove', move); container.addEventListener('pointerup', cancel); container.addEventListener('pointercancel', cancel); container.addEventListener('click', click, true)
    return () => { cancel(); map.off('contextmenu', menu); map.off('movestart', cancel); container.removeEventListener('pointerdown', down); container.removeEventListener('pointermove', move); container.removeEventListener('pointerup', cancel); container.removeEventListener('pointercancel', cancel); container.removeEventListener('click', click, true) }
  }, [])
  useEffect(() => { const map = leafletMap.current; const districtLayer = districtLayerRef.current; if (!map || !districtLayer) return; let active = true; fetch(districtGeoJsonUrl).then((response) => response.json()).then((geojson) => { if (!active) return; setDistrictNames([...new Set<string>((geojson.features || []).map((feature: { properties?: { NAME_3?: string } }) => feature.properties?.NAME_3).filter((name: string | undefined): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'de'))); const adjacency = districtAdjacency(geojson); const neighborDistricts = new Set([...activeDistricts].flatMap((name) => [...(adjacency.get(name) || [])])); const layer = L.geoJSON(geojson, { pane: 'districts', style: (feature) => { const name = feature?.properties?.NAME_3 || ''; const selected = activeDistricts.has(name); const neighbor = neighborDistricts.has(name); return { color: selected ? '#81f0b0' : neighbor ? '#c4a6ff' : '#9fb0aa', weight: selected ? 2 : neighbor ? 1.3 : 0.45, opacity: selected || neighbor ? 0.9 : 0.22, fillColor: selected ? '#48d987' : '#9b83ff', fillOpacity: selected ? 0.26 : neighbor ? 0.12 : 0 }; }, onEachFeature: (feature, featureLayer) => { const name = feature.properties?.NAME_3; if (activeDistricts.has(name) || neighborDistricts.has(name)) featureLayer.bindTooltip(name, { sticky: true, className: activeDistricts.has(name) ? 'district-tooltip active' : 'district-tooltip neighbor' }); } }); districtLayer.addLayer(layer); }).catch(() => undefined); return () => { active = false; districtLayer.clearLayers() } }, [activeDistricts])
  useEffect(() => { const group = layersRef.current; if (!group) return; group.clearLayers(); if (showFlights) filteredFlights.forEach((flight) => { const markerHtml = `<div class="radar-marker ${flight.type === 'HELI' ? 'is-other-heli' : ''} ${selectedFlight?.id === flight.id ? 'is-selected' : ''}" style="--marker:${flight.accent}"><div class="radar-square"></div><div class="radar-leader"></div><div class="radar-label"><strong>${escapeHtml(flight.callSign)}</strong><span>${flight.type}</span><span>${escapeHtml(flight.model)}</span></div></div>`; const marker = L.marker(flight.coords, { icon: L.divIcon({ className: 'flight-icon', html: markerHtml, iconSize: flight.type === 'HELI' ? [18, 18] : [270, 80], iconAnchor: flight.type === 'HELI' ? [9, 9] : [12, 68] }) }).addTo(group); marker.on('click', () => { setSelectedFlight(flight); setPanelOpen(true) }) }); if (showPads) pads.filter((pad) => pad.active).forEach((pad) => { const marker = L.marker(pad.coords, { icon: L.divIcon({ className: 'pad-icon', html: `<div>${pad.category === 'Krankenhaus' ? '✚' : '⌂'}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindTooltip(pad.name, { direction: 'top', offset: [0, -12] }).addTo(group); marker.on('click', () => { setSelectedPad(pad); setMapMenu(null) }) }) }, [filteredFlights, selectedFlight, showFlights, showPads, pads])
  useEffect(() => {
    const map = leafletMap.current
    if (!map || !own.position) return
    const { coords, accuracy } = own.position
    const marker = L.marker(coords, { zIndexOffset: 1000, icon: L.divIcon({ className: 'flight-icon', html: '<div class="radar-marker own-position" style="--marker:#ff4545"><div class="radar-square"></div><div class="radar-leader"></div><div class="radar-label"><strong>Own Position</strong></div></div>', iconSize: [270, 80], iconAnchor: [12.5, 67.5] }) }).addTo(map)
    const circle = L.circle(coords, { radius: accuracy, color: '#ff4545', weight: 1, fillOpacity: 0.07, interactive: false }).addTo(map)
    marker.bindTooltip('Own Position · Genauigkeit ±' + Math.round(accuracy) + ' m')
    if (centerOwn.current && germanyBounds.contains(coords)) { map.flyTo(coords, Math.max(map.getMinZoom(), 12)); centerOwn.current = false }
    return () => { marker.remove(); circle.remove() }
  }, [own.position])
  const locate = () => { centerOwn.current = true; own.start(); if (own.position && germanyBounds.contains(own.position.coords)) { leafletMap.current?.flyTo(own.position.coords, 12); centerOwn.current = false } }; const zoom = (delta: number) => leafletMap.current?.setZoom((leafletMap.current.getZoom() || 10) + delta)
  const createPad = () => { if (!mapMenu) return; setPadDraft({ id: `pad-${Date.now()}`, name: 'Neuer Landeplatz', category: 'Wiese', coords: mapMenu.coords, notes: '', active: true }); setMapMenu(null) }
  const savePad = () => { if (!padDraft || !padDraft.name.trim() || Math.abs(padDraft.coords[0]) > 90 || Math.abs(padDraft.coords[1]) > 180) return; setPads((current) => current.some((pad) => pad.id === padDraft.id) ? current.map((pad) => pad.id === padDraft.id ? padDraft : pad) : [...current, padDraft]); setSelectedPad(padDraft); setPadDraft(null) }
  const removePad = () => { if (!padDraft || !window.confirm(`Landeplatz „${padDraft.name}“ löschen?`)) return; setPads((current) => current.filter((pad) => pad.id !== padDraft.id)); setSelectedPad(null); setPadDraft(null) }
  return <main className="map-app" ><div ref={mapRef} className="leaflet-map" />{persistenceStatus === 'error' && <div className="sync-error" role="alert">Nicht gespeichert: {saveError}. <button onClick={() => location.reload()}>Neu laden</button></div>}
    {mapMenu && <div className="map-context-menu glass-card" style={{ left: Math.min(mapMenu.x, window.innerWidth - 250), top: Math.min(mapMenu.y, window.innerHeight - 130) }} onClick={(event) => event.stopPropagation()}><strong>Kartenpunkt</strong><span>{mapMenu.coords[0].toFixed(5)}° N · {mapMenu.coords[1].toFixed(5)}° E</span><button onClick={createPad}>＋ Landeplatz anlegen</button></div>}
    {(own.error || (own.enabled && !own.position) || (own.position && !germanyBounds.contains(own.position.coords))) && <div className="location-message" role="status">{own.error || (!own.position ? 'Standort wird ermittelt …' : 'Dein Standort liegt außerhalb des Deutschland-Ausschnitts.')}</div>}
    <div className="top-left-stack"><div className="brand-pill"><Logo /><span className="brand-divider" /><span className="brand-context">EINSATZRAUM NORD</span></div><div className="search-box"><Icon>⌕</Icon><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Flug, Ort oder Kennung suchen" /><kbd>⌘ K</kbd></div></div>
    <div className="top-right-stack"><div className="status-pill"><span className="pulse-dot" /> {dataMode === 'live' ? 'LIVE ADS-B' : 'KEINE LIVE-DATEN'} <span>alle 30 Sek.</span></div><div className="notification-wrap"><button className="glass-button notification" aria-label="Benachrichtigungen" onClick={() => { setShowNotifications(!showNotifications); setReadAt(Date.now()) }}>♧{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{showNotifications && <div className="notification-popover"><div className="popover-title"><span>Benachrichtigungen</span><small>Live</small></div><div className="notice-list" aria-live="polite">{notices.length ? notices.map((notice) => <button className="notification-item" key={notice.id} onClick={() => { const flight = flights.find((item) => item.id === notice.flightId); if (flight) { setSelectedFlight(flight); setPanelOpen(true); leafletMap.current?.flyTo(flight.coords, 11) } setShowNotifications(false) }}><div><strong>{notice.title}</strong><span>{new Date(notice.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div></button>) : <p>Noch keine neuen Flugänderungen empfangen.</p>}</div><button className="popover-link" onClick={enableNotifications}>Systemmeldungen aktivieren</button><button className="popover-link" onClick={() => { setShowNotifications(false); setShowSettings(true) }}>Benachrichtigungen verwalten →</button></div>}</div><button className="glass-button settings-trigger" aria-label="Einstellungen" onClick={() => setShowSettings(true)}>⚙</button><button className="avatar" aria-label="Profil und Einstellungen" onClick={() => setShowSettings(true)}>FA</button></div>
    <div className="map-toolbar glass-card"><button className="tool-button active" onClick={() => setShowFlights(!showFlights)}><span className="tool-symbol">✦</span><small>Fluege</small><i className={showFlights ? 'on' : ''} /></button><button className="tool-button" onClick={() => setShowPads(!showPads)}><span className="tool-symbol">⌂</span><small>Landeplaetze</small><i className={showPads ? 'on' : ''} /></button><span className="toolbar-line" /><button className="tool-button" onClick={() => setMuted(!muted)}><span className="tool-symbol">{muted ? '♢' : '◖'}</span><small>{muted ? 'Stumm' : 'Ton an'}</small></button></div>
    <div className="map-controls glass-card"><button onClick={() => zoom(1)} aria-label="Vergroessern">＋</button><button onClick={() => zoom(-1)} aria-label="Verkleinern">−</button><span /><button onClick={locate} aria-label="Eigenen Standort anzeigen" title="Own Position">⌾</button></div>
    {!panelOpen && <button className="reopen-details glass-button" onClick={() => setPanelOpen(true)} aria-label="Flugdetails öffnen">Flugdetails ↑</button>}
    <div className={`flight-sheet glass-card ${panelOpen ? 'open' : 'closed'}`}><button className="sheet-collapse" onClick={() => setPanelOpen(!panelOpen)} aria-label="Flugdetails schließen"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>{selectedFlight ? <><div className="sheet-header"><div><span className="eyebrow"><span className="pulse-dot" /> ECHTER ADS-B FLUG</span><h1>{selectedFlight.callSign}</h1><p>{selectedFlight.operator} <span>·</span> {selectedFlight.type} / {selectedFlight.model}</p></div><div className="aircraft-icon" style={{ background: selectedFlight.accent }}>✦</div></div><div className="flight-live"><span className="live-badge">● LIVE</span><span>{selectedFlight.location}</span></div><div className="flight-metrics"><div><span>HOEHE</span><strong>{selectedFlight.altitude}</strong></div><div><span>GESCHWINDIGKEIT</span><strong>{selectedFlight.speed}</strong></div></div><button className="track-button" onClick={() => leafletMap.current?.flyTo(selectedFlight.coords, 13, { duration: 0.8 })}>Flug auf Karte verfolgen <Icon>↗</Icon></button><div className="sheet-footer"><span><span className="green-dot" /> ADS-B Position aktuell</span><span>gerade eben</span></div></> : <div className="empty-flight"><span className="empty-icon">✦</span><strong>{dataMode === 'offline' ? 'Live-Verbindung unterbrochen' : 'Keine passenden Flugpositionen'}</strong><p>{dataMode === 'offline' ? 'Der Live-Dienst ist derzeit nicht erreichbar. Neuer Versuch alle 30 Sekunden.' : `${flights.length} Hubschrauber empfangen. Prüfe Filter und Kartenausschnitt.`}</p></div>}</div>
    {showSettings && <div className="settings-backdrop" onClick={(event) => event.target === event.currentTarget && setShowSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-head"><div><span className="eyebrow">RTHtrack · CONTROL CENTER</span><h2 id="settings-title">Einstellungen</h2></div><button className="close-settings" onClick={() => setShowSettings(false)}>×</button></div><p className="settings-lead">Deine Karte, deine Einsatzräume, deine Warnungen.</p><div className="settings-section"><div className="settings-section-title"><div><strong>Einsatzräume</strong><span>Landkreise auf der Karte hervorheben</span></div><small>{districts.length}/20</small></div><div className="district-input-row"><input list="district-options" value={districtInput} onChange={(event) => setDistrictInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addDistrict()} placeholder="Landkreis eingeben …" disabled={districts.length >= 20} /><button onClick={addDistrict} disabled={!districtInput.trim() || districts.length >= 20}>Hinzufügen</button></div><datalist id="district-options">{districtNames.map((name) => <option key={name} value={name} />)}</datalist>{districtSuggestions.length > 0 && <div className="district-autocomplete">{districtSuggestions.map((name) => <button key={name} onClick={() => { setDistrictInput(name); setDistricts([...districts, name]); setDistrictInput('') }}>+ {name}</button>)}</div>}<div className="settings-chips">{districts.map((district) => <button key={district} className="chosen" onClick={() => setDistricts(districts.filter((item) => item !== district))}>{district} <span>×</span></button>)}</div></div><div className="settings-section"><div className="settings-section-title"><div><strong>Kartenebenen</strong><span>Was soll sichtbar sein?</span></div></div><label className="setting-row"><span><b>RTH / ITH</b><small>Rettungshubschrauber und Intensivtransport</small></span><input type="checkbox" checked={showFlights} onChange={() => setShowFlights(!showFlights)} /><i className="settings-switch" /></label><label className="setting-row"><span><b>Landeplätze</b><small>Klinik- und Außenlandeplätze</small></span><input type="checkbox" checked={showPads} onChange={() => setShowPads(!showPads)} /><i className="settings-switch" /></label><label className="setting-row"><span><b>Sonstige Helikopter</b><small>Zusätzliche Rotorcraft aus dem Live-Feed</small></span><input type="checkbox" checked={showOtherHelis} onChange={() => setShowOtherHelis(!showOtherHelis)} /><i className="settings-switch" /></label></div><div className="settings-section"><div className="settings-section-title"><div><strong>Benachrichtigungen</strong><span>Nur echte Live-ADS-B-Ereignisse</span></div><span className="live-state">{notificationsEnabled ? 'AKTIV' : 'STUMM'}</span></div><label className="setting-row"><span><b>In-App-Benachrichtigungen</b><small>Neue RTH/ITH und Änderungen ihres ADS-B-Flugstatus</small></span><input type="checkbox" checked={notificationsEnabled} onChange={() => setNotificationsEnabled(!notificationsEnabled)} /><i className="settings-switch" /></label><button className="save-settings" onClick={enableNotifications}>Systemmeldungen aktivieren</button><p className="settings-lead">{notificationMessage || 'Meldungen werden bei geöffneter App aus neuen Live-Daten erzeugt. Keine Hintergrund-Push-Zustellung bei geschlossener App.'}</p></div><div className="settings-section"><strong>Landeplätze verwalten</strong><p className="settings-lead">Zum Anlegen die Karte gedrückt halten oder rechts klicken.</p>{pads.map((pad) => <button className="pad-manage" key={pad.id} onClick={() => { setShowSettings(false); setPadDraft(pad) }}>{pad.name}<small>{pad.category} · {pad.active ? 'Sichtbar' : 'Ausgeblendet'}</small></button>)}</div><div className="persistence-state">{persistenceStatus === 'server' ? '✓ Geräteübergreifend synchronisiert' : persistenceStatus === 'error' ? `Nicht gespeichert: ${saveError}` : persistenceStatus === 'saving' ? 'Wird auf dem Server gespeichert …' : 'Einstellungen werden geladen …'}</div><label className="field-label">Privater Profil-Link für andere Geräte<input readOnly value={location.href} onFocus={(event) => event.target.select()} /></label><p className="settings-lead">Diesen Link als Lesezeichen speichern und auf deinen anderen Geräten öffnen. Jeder mit diesem Link kann dein Profil und deine Landeplätze bearbeiten.</p><button className="save-settings" disabled={persistenceStatus !== 'server'} onClick={() => setShowSettings(false)}>Fertig</button></section></div>}
    {selectedPad && !padDraft && <div className="pad-details glass-card"><div className="settings-head"><div><span className="eyebrow">LANDEPLATZ</span><h2>{selectedPad.name}</h2></div><button className="close-settings" onClick={() => setSelectedPad(null)}>×</button></div><div className="pad-category-badge">{selectedPad.category}</div><p>{selectedPad.notes || 'Keine weiteren Hinweise hinterlegt.'}</p><small>{selectedPad.coords[0].toFixed(5)}° N · {selectedPad.coords[1].toFixed(5)}° E</small><button className="save-settings" onClick={() => setPadDraft(selectedPad)}>Landeplatz bearbeiten</button></div>}
    {padDraft && <div className="settings-backdrop"><section className="settings-modal pad-editor" role="dialog" aria-modal="true"><div className="settings-head"><div><span className="eyebrow">LANDEPLATZ PFLEGEN</span><h2>{padDraft.id.startsWith('pad-') && !pads.some((pad) => pad.id === padDraft.id) ? 'Neuen Landeplatz' : 'Landeplatz bearbeiten'}</h2></div><button className="close-settings" onClick={() => setPadDraft(null)}>×</button></div><label className="field-label">Bezeichnung<input value={padDraft.name} onChange={(event) => setPadDraft({ ...padDraft, name: event.target.value })} /></label><label className="field-label">Kategorie<select value={padDraft.category} onChange={(event) => setPadDraft({ ...padDraft, category: event.target.value as PadCategory })}>{padCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="pad-coordinates"><label className="field-label">Breitengrad<input type="number" min="-90" max="90" step="0.00001" value={padDraft.coords[0]} onChange={(event) => setPadDraft({ ...padDraft, coords: [Number(event.target.value), padDraft.coords[1]] })} /></label><label className="field-label">Längengrad<input type="number" min="-180" max="180" step="0.00001" value={padDraft.coords[1]} onChange={(event) => setPadDraft({ ...padDraft, coords: [padDraft.coords[0], Number(event.target.value)] })} /></label></div><label className="field-label">Hinweise<textarea value={padDraft.notes} onChange={(event) => setPadDraft({ ...padDraft, notes: event.target.value })} placeholder="z. B. Zufahrt, Hindernisse, Nachtbetrieb …" /></label><label className="setting-row"><span><b>Aktiv anzeigen</b><small>Auf der Karte sichtbar</small></span><input type="checkbox" checked={padDraft.active} onChange={() => setPadDraft({ ...padDraft, active: !padDraft.active })} /><i className="settings-switch" /></label><div className="pad-editor-actions"><button className="save-settings" disabled={!padDraft.name.trim() || persistenceStatus !== 'server'} onClick={savePad}>Speichern</button>{pads.some((pad) => pad.id === padDraft.id) && <button className="danger-button" onClick={removePad}>Löschen</button>}</div></section></div>}
    <div className="bottom-status"><span className="legend"><i className="active-district-dot" /> Einsatzraum <i className="neighbor-district-dot" /> Angrenzender LK <i className="rth-dot" /> RTH <i className="ith-dot" /> ITH <i className="heli-dot" /> Sonstiger Heli <i className="pad-dot" /> Landeplatz</span><span className="coordinates">53.18° N &nbsp; 10.38° E</span></div>
  </main>
}
export default App
