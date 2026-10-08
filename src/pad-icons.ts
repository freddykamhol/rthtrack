// Fixed SVG artwork only; no user content is interpolated into these icons.
export const padStyles = {
  Wiese: { color: '#88df93', paths: '<path d="M4 20h16M7 20c0-6-1-9-3-12m8 12V5m0 9c0-5 3-8 6-9m-2 15c0-4 2-7 4-8M8 15l-4-3"/>' },
  'Landeplatz beleuchtet': { color: '#ffdb79', paths: '<path d="M9 8v8m6-8v8m-6-4h6"/><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M2 6V3h3m14 0h3v3m0 12v3h-3M5 21H2v-3"/>' },
  Krankenhaus: { color: '#90caff', paths: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>' },
  Feuerwehr: { color: '#ff9475', paths: '<path d="M13 2c1 6 6 7 6 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 4 2-3 2-6 2-9Z"/><path d="M12 13c-1 3-3 3-3 5a3 3 0 0 0 6 0c0-2-2-3-3-5Z"/>' },
  Sportplatz: { color: '#bda5ff', paths: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 9h3v6H3m18-6h-3v6h3"/><circle cx="12" cy="12" r="3"/>' },
  Sonstige: { color: '#c0cbd2', paths: '<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2"/>' },
} as const

export type PadCategory = keyof typeof padStyles
export function padIconSvg(category: PadCategory): string {
  const style = padStyles[category] || padStyles.Sonstige
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${style.paths}</svg>`
}
