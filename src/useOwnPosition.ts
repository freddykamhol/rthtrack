import { useEffect, useState } from 'react'

export function useOwnPosition() {
  const [enabled, setEnabled] = useState(false)
  const [position, setPosition] = useState<{ coords: [number, number]; accuracy: number; timestamp: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled || !navigator.geolocation) return
    const watch = navigator.geolocation.watchPosition((result) => {
      setPosition({ coords: [result.coords.latitude, result.coords.longitude], accuracy: result.coords.accuracy, timestamp: result.timestamp })
      setError('')
    }, (failure) => {
      setError(failure.code === 1 ? 'Standortzugriff abgelehnt. Bitte in den Browser-Einstellungen erlauben.' : failure.code === 3 ? 'Standortsuche dauert zu lange. Bitte erneut versuchen.' : 'Standort momentan nicht verfügbar.')
      setEnabled(false)
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 })
    return () => navigator.geolocation.clearWatch(watch)
  }, [enabled])
  const start = () => {
    if (!navigator.geolocation) { setError('Dieser Browser unterstützt keine Standortbestimmung.'); return }
    setError(''); setEnabled(true)
  }
  return { position, error, enabled, start }
}
