# RTHtrack – Produktidee

## Zweck

Ein hochmodernes, mobiloptimiertes Tool für Rettungskräfte am Boden. Die App zeigt Rettungshubschrauber in Echtzeit auf einer Karte und informiert Nutzer:innen über relevante Bewegungen in ihren Einsatzräumen.

## Kernfunktionen

- Hochmoderne Karte als zentrale Arbeitsoberfläche
- ADS-B-Daten für Rettungshubschrauber (RTH und ITH)
- Unterschiedliche Karten-Icons für RTH und ITH
- Nutzer:innen können bis zu drei Landkreise als persönliche Einsatzräume hinterlegen
- Benachrichtigungen, wenn ein RTH/ITH im eigenen Landkreis oder in einem Nachbarkreis unterwegs ist
- Ereignisbezogene Benachrichtigungen: gestartet, gelandet, eigener Einsatzraum, Nachbarkreis
- Geräte- und benutzerbezogene Einstellungen
- Systemweite, gemeinschaftlich gepflegte Landeplatzdatenbank
- Landeplätze können von allen Nutzer:innen eingesehen, angelegt, bearbeitet und gelöscht werden
- Optimierung für Mobilgeräte und Desktop

## Aktueller UI-Stand

Die erste UI-Konzeption ist in `src/App.tsx` umgesetzt:

- Kartenansicht mit Flugobjekten, Legende und ausgewähltem Flugdetail
- Umschaltung zwischen Karte und Landeplätzen
- Filter „Nur meine Einsatzräume“
- Übersicht der letzten Meldungen
- Einsatzraum-Tags für bis zu drei Landkreise
- Einstellungsdialog mit Landkreis-Auswahl und vier Benachrichtigungsschaltern
- Responsive Layouts für mobile Geräte und Desktop

## Nächste Ausbaustufen

1. ADS-B-Quelle auswählen und Live-Daten-Adapter anbinden.
2. Landkreis- und Nachbarlandkreis-Geometrien serverseitig ermitteln.
3. Push-Benachrichtigungen und Geräteeinstellungen ergänzen.
4. Authentifizierung und Rollen/Rechte für die Landeplatzpflege definieren.
5. Gemeinsame Landeplatzdatenbank mit Änderungsverlauf, Moderation und Geokoordinaten anbinden.
6. Kartenanbieter und Offline-/Schlechtverbindungs-Verhalten festlegen.
