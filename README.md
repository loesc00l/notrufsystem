# Prüfprotokoll Notrufsystem (DIN VDE 0834)

Notrufsystem Test AWO – eine reine Browser-Web-App zur Prüfung und
Dokumentation eines Notrufsystems nach DIN VDE 0834. Frontend läuft statisch
auf **GitHub Pages**, Daten und Login laufen über **Supabase** (kostenloser Plan).

**Live-URL:** https://loesc00l.github.io/notrufsystem/

## Inhalt

- `index.html` / `styles.css` / `app.js` – die Web-App (single page)
- `config.js` – Supabase-URL und Anon-Key
- `supabase/schema.sql` – Tabellen, RLS-Policies, Hilfsfunktion
- `supabase/seed_geraete.sql` – Stamm-Geräteliste (546 Geräte) für den Katalog
- `.github/workflows/pages.yml` – automatisches Deployment nach GitHub Pages

---

## 1. Supabase-Projekt anlegen (kostenlos)

1. Unter <https://supabase.com> registrieren und neues **Project** anlegen
   (Region Europe, Passwort für die Datenbank vergeben, merken reicht).
2. Im linken Menü **SQL Editor** öffnen.
3. Inhalt von `supabase/schema.sql` einfügen und ausführen.
4. Danach `supabase/seed_geraete.sql` einfügen und ausführen.
   Damit werden alle 546 Geräte aus der Excel-Liste in den Katalog geladen.
5. Unter **Authentication → Providers → Email** sicherstellen, dass
   "Email" aktiviert ist. Für den Anfang kannst du unter
   **Authentication → Email Templates → Confirm signup** die
   "Confirm email" auch **deaktivieren**, dann kannst du dich sofort einloggen.
6. Unter **Project Settings → API** kopierst du:
   - **Project URL** → in `config.js` bei `SUPABASE_URL`
   - **anon public** Key → in `config.js` bei `SUPABASE_ANON_KEY`

> Diese beiden Werte sind **nicht geheim** – sie dürfen öffentlich im Repo
> stehen. Zugriffsschutz läuft über die RLS-Policies und den Login.

## 2. Lokal testen

Da die Seite statisch ist, reicht jeder einfache HTTP-Server:

```bash
cd notrufsystem
python3 -m http.server 8080
# Browser: http://localhost:8080
```

Erst registrieren (einmalig), dann einloggen. Beim ersten Login wirst du
aufgefordert, ein Protokoll anzulegen – die 546 Geräte werden automatisch
aus dem Katalog übernommen.

## 3. Deployment auf GitHub Pages

1. Repo auf GitHub: <https://github.com/loesc00l/notrufsystem>
2. In GitHub **Settings → Pages** als Quelle **"GitHub Actions"** wählen.
3. Der Workflow `.github/workflows/pages.yml` deployt automatisch nach jedem
   Push auf `main`. Die URL ist:
   **https://loesc00l.github.io/notrufsystem/**
4. In Supabase unter **Authentication → URL Configuration**:
   - **Site URL** auf `https://loesc00l.github.io/notrufsystem/` setzen
   - ggf. auch als "Additional Redirect URL"

## 4. Bedienung

| Tab | Zweck |
|-----|------|
| **Deckblatt** | Stammdaten des Prüfauftrags (Krankenhaus, Station, Prüfer, Termine …) |
| **Prüfliste** | Alle Geräte, pro Gerät acht Prüfkriterien (OK / NOK / N/A) + Gesamtergebnis |
| **Mängelliste** | Automatisch angelegt, wenn ein Gerät "NOK" hat; manuell ergänzbar |
| **Export** | XLSX-Export (alle drei Blätter) oder PDF per Browser-Druck |

Tipps:

- **"Alle OK"** pro Zeile: setzt alle acht Prüfkriterien und das Gesamtergebnis auf OK.
- **Gesamtergebnis** wird automatisch auf *NOK* gesetzt, sobald ein
  Kriterium NOK ist – und auf *OK*, sobald alle Kriterien gesetzt und nicht NOK sind.
- **NOK**-Geräte werden automatisch als Eintrag in die Mängelliste kopiert.
- **Filter**: Volltext (Raum/Anzeige/Typ) und Status (offen/OK/NOK/NA).

## 5. Mehrere Prüfer

Jeder Prüfer registriert sich mit eigener E-Mail. Wenn mehrere Leute am
selben Protokoll arbeiten sollen, passe `supabase/schema.sql` an – aktuell
sieht nur der Besitzer (`owner`) sein Protokoll (RLS).

## 6. Backup

In Supabase: **Database → Backups** (automatisch im Free Plan).
Oder jederzeit selbst über **Export → Excel herunterladen** in der App.
