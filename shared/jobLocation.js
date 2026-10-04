// ── Job-location resolution ──────────────────────────────────────────────────
// Matching must be location-aware: a candidate in Hyderabad should see India +
// worldwide-remote roles first, never Sydney on-site roles. Resolution order:
//   1. explicit manual override (localStorage, set from the Jobs screen)
//   2. profile location (shared with Solo/Live setup)
//   3. auto-detect from the device timezone (FREE, private, no network call)
//
// Why timezone instead of the laptop's IP? IP geolocation ships your IP to a
// third-party service (privacy), and is often WRONG behind VPNs, corporate
// NATs and carrier CGN — a Hyderabad user on a US VPN would get US jobs. The
// OS timezone is user-controlled, stable, and country-accurate; the user can
// always override with an exact city ("Hyderabad, India") for city-level Adzuna
// search.

export const JOB_LOC_KEY = 'mm-jobs-loc-v1'
export const JOB_COMPANY_KEY = 'mm-jobs-company-v1'

const TZ_COUNTRY = [
  [/^Asia\/(Kolkata|Calcutta)$/, 'India'],
  [/^Asia\/Dubai$/, 'United Arab Emirates'],
  [/^Asia\/Singapore$/, 'Singapore'],
  [/^Asia\/Tokyo$/, 'Japan'],
  [/^Asia\/Seoul$/, 'South Korea'],
  [/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi)$/, 'China'],
  [/^Asia\/Karachi$/, 'Pakistan'],
  [/^Asia\/Dhaka$/, 'Bangladesh'],
  [/^Asia\/Colombo$/, 'Sri Lanka'],
  [/^Asia\/Kathmandu$/, 'Nepal'],
  [/^Asia\/Jakarta$/, 'Indonesia'],
  [/^Asia\/Manila$/, 'Philippines'],
  [/^Asia\/Bangkok$/, 'Thailand'],
  [/^Asia\/Ho_Chi_Minh$/, 'Vietnam'],
  [/^Asia\/Kuala_Lumpur$/, 'Malaysia'],
  [/^Asia\/Riyadh$/, 'Saudi Arabia'],
  [/^Asia\/(Tel_Aviv|Jerusalem)$/, 'Israel'],
  [/^Australia\/(Sydney|Melbourne|Brisbane|Perth|Adelaide)$/, 'Australia'],
  [/^Pacific\/Auckland$/, 'New Zealand'],
  [/^Europe\/London$/, 'United Kingdom'],
  [/^Europe\/Dublin$/, 'Ireland'],
  [/^Europe\/Berlin$/, 'Germany'],
  [/^Europe\/Paris$/, 'France'],
  [/^Europe\/Amsterdam$/, 'Netherlands'],
  [/^Europe\/Madrid$/, 'Spain'],
  [/^Europe\/Rome$/, 'Italy'],
  [/^Europe\/Warsaw$/, 'Poland'],
  [/^Europe\/Lisbon$/, 'Portugal'],
  [/^Europe\/Stockholm$/, 'Sweden'],
  [/^America\/(New_York|Detroit|Indiana|Kentucky|Chicago|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau)$/, 'United States'],
  [/^America\/(Toronto|Vancouver|Montreal|Edmonton|Winnipeg|Halifax)$/, 'Canada'],
  [/^America\/(Sao_Paulo|Bahia|Fortaleza|Manaus|Rio_Branco)$/, 'Brazil'],
  [/^America\/(Mexico_City|Tijuana|Monterrey)$/, 'Mexico'],
]

// Country-level hint from the OS timezone; '' when unknown (caller keeps prior behavior).
export function inferLocationFromTimezone(tz = '') {
  const t = String(tz || '').trim()
  if (!t) return ''
  for (const [re, country] of TZ_COUNTRY) if (re.test(t)) return country
  return ''
}

// Effective location + where it came from, for transparent UI labeling.
export function resolveJobLocation({ override = '', profileLocation = '', timezone = '' } = {}) {
  const o = String(override || '').trim()
  if (o) return { location: o, source: 'manual' }
  const p = String(profileLocation || '').trim()
  if (p) return { location: p, source: 'profile' }
  const a = inferLocationFromTimezone(timezone)
  if (a) return { location: a, source: 'auto' }
  return { location: '', source: '' }
}

export function locationSourceLabel(source) {
  if (source === 'manual') return 'your override'
  if (source === 'profile') return 'from profile'
  if (source === 'auto') return 'auto · timezone'
  return 'not set'
}
