type EventFlight = { id: string; callSign: string; type: string; status: string }
export function flightEvents(previous: EventFlight[] | null, current: EventFlight[]): { flightId: string; title: string }[]
