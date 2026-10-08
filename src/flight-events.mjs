// Only compare consecutive successful snapshots; disappearing signals are not landings.
export function flightEvents(previous, current) {
  if (!previous) return []
  const old = new Map(previous.map((flight) => [flight.id, flight]))
  return current.filter((flight) => flight.type !== 'HELI').flatMap((flight) => {
    const before = old.get(flight.id)
    const title = !before ? `${flight.callSign}: neu im Live-Feed` : before.status !== flight.status ? `${flight.callSign}: ${flight.status === 'Am Boden' ? 'Bodenstatus empfangen' : 'Flugstatus empfangen'}` : ''
    return title ? [{ flightId: flight.id, title }] : []
  })
}
