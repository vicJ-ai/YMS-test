import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowLeftRight, BarChart3, Bell, Boxes,
  CalendarDays, Check, ChevronDown, CircleParking, Container, DoorOpen,
  Download, Home, Inbox, LoaderCircle, LocateFixed, LogOut, MapPin, Moon,
  RefreshCw, Search, Settings, Sun, Truck, UserRound, X, type LucideIcon,
} from 'lucide-react'
import './App.css'

type Theme = 'light' | 'dark'
type ResourceName = 'equipment' | 'appointments' | 'gates' | 'locations'
type JsonRecord = Record<string, unknown>

type Yard = { yardId: string; yardName: string; timezone: string }
type Session = {
  authenticated: true
  user: { name: string }
  yards: Yard[]
  activeYardId: string
  activeYardName: string
  timezone: string
}
type PageResult = {
  list: JsonRecord[]
  totalCount: number
  currentPage: number
  pageSize: number
  totalPage: number
}
type ResourceState = { loading: boolean; error: string; data: PageResult | null }
type DashboardState = { loading: boolean; error: string; data: JsonRecord | null }
type AlertsState = { loading: boolean; error: string; pending: JsonRecord[]; configuration: JsonRecord[] }
type Column = { label: string; render: (record: JsonRecord) => ReactNode }

const navItems: { label: string; icon: LucideIcon }[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Yard Management', icon: Boxes },
  { label: 'Gate Operations', icon: DoorOpen },
  { label: 'Containers', icon: Container },
  { label: 'Appointments', icon: CalendarDays },
  { label: 'Yard Map', icon: MapPin },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Alerts', icon: Bell },
  { label: 'Settings', icon: Settings },
]

const emptyResource = (): ResourceState => ({ loading: false, error: '', data: null })
const emptyResources = (): Record<ResourceName, ResourceState> => ({
  equipment: emptyResource(), appointments: emptyResource(), gates: emptyResource(), locations: emptyResource(),
})

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown, fallback = 'Not available') {
  if (value === null || value === undefined || value === '') return fallback
  if (Array.isArray(value)) return value.length ? value.map((item) => stringValue(item, '')).filter(Boolean).join(', ') : fallback
  if (typeof value === 'object') return fallback
  return String(value)
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatNumber(value: unknown) {
  const parsed = numberValue(value)
  return parsed === null ? 'Not available' : new Intl.NumberFormat().format(parsed)
}

function formatDate(value: unknown, timezone: string) {
  if (typeof value !== 'string' || !value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
}

function titleCase(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toneFor(value: unknown) {
  const status = String(value || '').toLowerCase()
  if (/(complete|approved|active|available|enabled|verified|in.?yard|open)/.test(status)) return 'success'
  if (/(pending|scheduled|remaining|waiting|reserved|ongoing)/.test(status)) return 'warning'
  if (/(error|exception|failed|disabled|blocked|cancel|overdue)/.test(status)) return 'danger'
  return 'neutral'
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'YO'
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || 'This information is temporarily unavailable.')
  return payload as T
}

function ThemeControl({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <button className="theme-switch" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
    <Sun size={16} /><span className="switch-track"><i /></span><Moon size={16} />
  </button>
}

function Login({ theme, setTheme, onAuthenticated }: { theme: Theme; setTheme: (theme: Theme) => void; onAuthenticated: (session: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const session = await api<Session>('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username: username.trim(), password }),
      })
      setPassword('')
      onAuthenticated(session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in is temporarily unavailable.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-page">
    <div className="login-top"><img src="/brand/item-logo-fullcolor-blacktxt.svg" alt="Item" className="light-logo" /><img src="/brand/item-white-logo.svg" alt="Item" className="dark-logo" /><ThemeControl theme={theme} setTheme={setTheme} /></div>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-mark"><img src="/brand/logo-mark-roundedsquare-fullcolor.svg" alt="" /></div>
      <p className="eyebrow">Yard Management System</p>
      <h1 id="login-title">Sign in to your yard</h1>
      <p className="login-intro">Use your Item account to access the yards assigned to you.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
        {error && <div className="form-error" role="alert"><AlertTriangle size={17} />{error}</div>}
        <button className="button primary login-submit" type="submit" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={17} /> Signing in...</> : 'Sign in'}</button>
      </form>
    </section>
  </main>
}

function LoadingState({ label = 'Loading yard information...' }: { label?: string }) {
  return <div className="state-panel" role="status"><LoaderCircle className="spin" size={24} /><strong>{label}</strong></div>
}

function MessageState({ icon: Icon = Inbox, title, message, action }: { icon?: LucideIcon; title: string; message: string; action?: ReactNode }) {
  return <div className="state-panel"><Icon size={25} /><strong>{title}</strong><span>{message}</span>{action}</div>
}

function StatusBadge({ value }: { value: unknown }) {
  const label = stringValue(value)
  return <span className={`status-badge ${toneFor(value)}`}>{label}</span>
}

function PageHeader({ title, subtitle, loading, onRefresh, children }: { title: string; subtitle: string; loading?: boolean; onRefresh?: () => void; children?: ReactNode }) {
  return <div className="module-header">
    <div><p className="eyebrow">Yard operations</p><h2>{title}</h2><span>{subtitle}</span></div>
    <div className="module-actions">{children}{onRefresh && <button type="button" className="button secondary icon-text" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Refresh</button>}</div>
  </div>
}

function KpiCard({ label, value, meta, tone, icon: Icon }: { label: string; value: string; meta: string; tone: string; icon: LucideIcon }) {
  return <article className="kpi-card" tabIndex={0}><span className={`kpi-icon ${tone}`}><Icon size={24} /></span><span className="kpi-copy"><small>{label}</small><strong>{value}</strong><em>{meta}</em></span></article>
}

function DashboardView({ state, timezone, onRefresh }: { state: DashboardState; timezone: string; onRefresh: () => void }) {
  if (state.loading && !state.data) return <><PageHeader title="Dashboard" subtitle="Current activity for the selected yard" /><LoadingState label="Loading yard overview..." /></>
  if (state.error && !state.data) return <><PageHeader title="Dashboard" subtitle="Current activity for the selected yard" /><MessageState icon={AlertTriangle} title="Dashboard unavailable" message={state.error} action={<button className="button secondary" type="button" onClick={onRefresh}>Try again</button>} /></>
  if (!state.data) return null

  const overview = record(state.data.overview)
  const dock = record(overview.dockCapacity)
  const spots = record(overview.yardSpot)
  const summary = record(overview.equipmentSummary)
  const inYard = record(overview.equipmentInYard)
  const pickup = record(overview.carrierPickupSummary)
  const dwell = record(state.data.dwellTimeSummary)
  const today = record(state.data.appointmentsToday)
  const cards = [
    { label: 'Equipment in yard', value: formatNumber(inYard.totalCount), meta: `${formatNumber(inYard.containerCount)} containers`, tone: 'blue', icon: Container },
    { label: 'Yard positions', value: formatNumber(spots.occupied), meta: `${formatNumber(spots.total)} total`, tone: 'cyan', icon: MapPin },
    { label: 'Dock occupancy', value: numberValue(dock.occupancyPercent) === null ? 'Not available' : `${dock.occupancyPercent}%`, meta: `${formatNumber(dock.occupied)} of ${formatNumber(dock.total)}`, tone: 'green', icon: DoorOpen },
    { label: 'Needs loading', value: formatNumber(summary.needsLoadingCount), meta: 'Current equipment', tone: 'orange', icon: ArrowDownToLine },
    { label: 'Needs offloading', value: formatNumber(summary.needsOffloadingCount), meta: 'Current equipment', tone: 'sky', icon: Truck },
    { label: 'Pickup ready', value: formatNumber(pickup.totalCount), meta: 'Carrier pickup', tone: 'purple', icon: ArrowLeftRight },
  ]

  const appointmentSection = (direction: 'inbound' | 'outbound') => {
    const group = record(today[direction])
    const rows = Object.entries(group).flatMap(([key, value]) => {
      const metric = record(value)
      return value ? [{ key, scheduled: metric.scheduled, ongoing: metric.ongoing, remaining: metric.remaining }] : []
    })
    return <section className="data-card appointment-summary"><div className="section-heading"><span>{direction === 'inbound' ? <ArrowDownToLine size={18} /> : <ArrowLeftRight size={18} />}{titleCase(direction)} today</span></div>
      {rows.length ? <div className="metric-list">{rows.map((row) => <div key={row.key}><strong>{titleCase(row.key)}</strong><span><b>{formatNumber(row.scheduled)}</b> scheduled</span><span><b>{formatNumber(row.ongoing)}</b> ongoing</span><span><b>{formatNumber(row.remaining)}</b> remaining</span></div>)}</div> : <MessageState title={`No ${direction} appointments`} message="No activity is reported for today." />}
    </section>
  }

  const dwellRows = [
    ['Under 2 days', dwell.daysLessThanTwo], ['2 to 4 days', dwell.daysLessThanFive],
    ['5 to 49 days', dwell.daysLessThanFifty], ['50 days or more', dwell.daysFiftyOrMore],
  ] as const
  const dwellMax = Math.max(1, ...dwellRows.map(([, value]) => numberValue(value) || 0))

  return <>
    <PageHeader title="Dashboard" subtitle={`Live operational summary · ${timezone}`} loading={state.loading} onRefresh={onRefresh} />
    {state.error && <div className="inline-warning" role="status"><AlertTriangle size={16} />{state.error}</div>}
    <section className="kpi-row" aria-label="Yard key performance indicators">{cards.map((card) => <KpiCard key={card.label} {...card} />)}</section>
    <section className="dashboard-detail-grid">
      <section className="data-card dwell-card"><div className="section-heading"><span><CircleParking size={18} /> Equipment dwell</span></div><div className="bar-list">{dwellRows.map(([label, value]) => <div key={label}><div><span>{label}</span><strong>{formatNumber(value)}</strong></div><i><b style={{ width: `${((numberValue(value) || 0) / dwellMax) * 100}%` }} /></i></div>)}</div></section>
      {appointmentSection('inbound')}{appointmentSection('outbound')}
    </section>
  </>
}

function DataTable({ rows, columns, rowKey }: { rows: JsonRecord[]; columns: Column[]; rowKey: (row: JsonRecord, index: number) => string }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={rowKey(row, index)}>{columns.map((column) => <td key={column.label}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>
}

function ResourceView({
  title, subtitle, resource, state, timezone, query, setQuery, columns, rowKey, onPage, onRefresh, note,
}: {
  title: string; subtitle: string; resource: ResourceName; state: ResourceState; timezone: string
  query: string; setQuery: (query: string) => void; columns: Column[]; rowKey: (row: JsonRecord, index: number) => string
  onPage: (resource: ResourceName, page: number) => void; onRefresh: () => void; note?: string
}) {
  const normalized = query.trim().toLowerCase()
  const rows = state.data?.list || []
  const filtered = normalized ? rows.filter((row) => Object.values(row).some((value) => stringValue(value, '').toLowerCase().includes(normalized))) : rows
  return <>
    <PageHeader title={title} subtitle={subtitle} loading={state.loading} onRefresh={onRefresh}>
      <label className="module-search"><Search size={16} /><span className="sr-only">Search loaded {title.toLowerCase()}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded page" /></label>
    </PageHeader>
    {note && <div className="business-note"><AlertTriangle size={16} /><span>{note}</span></div>}
    {state.loading && !state.data ? <LoadingState /> : state.error && !state.data ? <MessageState icon={AlertTriangle} title={`${title} unavailable`} message={state.error} action={<button className="button secondary" type="button" onClick={onRefresh}>Try again</button>} /> : state.data && !rows.length ? <MessageState title={`No ${title.toLowerCase()} found`} message="There are no records for the selected yard." /> : state.data && !filtered.length ? <MessageState icon={Search} title="No matches on this page" message="Clear the search or load another page." /> : state.data ? <>
      {state.error && <div className="inline-warning" role="status"><AlertTriangle size={16} />{state.error}</div>}
      <section className="data-card table-card" aria-label={title}><DataTable rows={filtered} columns={columns} rowKey={rowKey} /><div className="pagination"><span>{new Intl.NumberFormat().format(state.data.totalCount)} records · Page {state.data.currentPage} of {Math.max(1, state.data.totalPage)}</span><div><button className="button secondary" type="button" disabled={state.loading || state.data.currentPage <= 1} onClick={() => onPage(resource, state.data!.currentPage - 1)}>Previous</button><button className="button secondary" type="button" disabled={state.loading || state.data.currentPage >= state.data.totalPage} onClick={() => onPage(resource, state.data!.currentPage + 1)}>Next</button></div></div></section>
    </> : null}
    <span className="sr-only">Times shown in {timezone}</span>
  </>
}

function locationTone(location: JsonRecord) {
  if (location.enabled === false) return 'exception'
  const status = String(location.locationStatus || '').toLowerCase()
  if (status.includes('reserved')) return 'reserved'
  if (status.includes('occup') || location.currentEntryId) return 'occupied'
  return 'available'
}

function YardMapView({
  locationState, equipmentState, query, setQuery, selected, setSelected, onRefresh, onUnavailable,
}: {
  locationState: ResourceState; equipmentState: ResourceState; query: string; setQuery: (query: string) => void
  selected: JsonRecord | null; setSelected: (location: JsonRecord) => void; onRefresh: () => void; onUnavailable: (title: string) => void
}) {
  if (locationState.loading && !locationState.data) return <LoadingState label="Loading yard locations..." />
  if (locationState.error && !locationState.data) return <MessageState icon={AlertTriangle} title="Yard map unavailable" message={locationState.error} action={<button type="button" className="button secondary" onClick={onRefresh}>Try again</button>} />
  const locations = locationState.data?.list || []
  const normalized = query.trim().toLowerCase()
  const matches = normalized ? locations.filter((location) => [location.locationName, location.displayName, location.locationType, location.groupName, location.currentCarrierName].some((value) => stringValue(value, '').toLowerCase().includes(normalized))) : locations
  const occupied = locations.filter((location) => locationTone(location) === 'occupied').length
  const available = locations.filter((location) => locationTone(location) === 'available').length
  const chosen = selected && locations.some((location) => location.locationId === selected.locationId) ? selected : locations[0] || null

  if (!locations.length) return <MessageState title="No yard locations found" message="There are no location records for the selected yard." />
  return <section className="command-grid">
    <div className="map-panel">
      <div className="map-toolbar"><div className="legend" aria-label="Location legend"><span><i className="occupied" />Occupied</span><span><i className="available" />Available</span><span><i className="reserved" />Reserved</span><span><i className="exception" />Unavailable</span></div><label className="search-box"><Search size={17} /><span className="sr-only">Search locations</span><input id="yard-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search location, group, or carrier" /><span>{normalized ? `${matches.length} found` : 'Loaded page'}</span></label></div>
      <div className="yard-map" aria-label="Yard location overview"><div className="map-road map-road-top"><span>ACTIVE YARD</span><span>LOCATION OVERVIEW</span></div><div className="map-grid real-map-grid" role="grid" aria-label="Yard locations">{locations.map((location) => {
        const isMatch = matches.includes(location)
        const isSelected = chosen?.locationId === location.locationId
        return <button key={stringValue(location.locationId)} type="button" role="gridcell" className={`container-tile ${locationTone(location)} ${isSelected ? 'selected' : ''} ${normalized && isMatch ? 'match' : ''} ${normalized && !isMatch ? 'dimmed' : ''}`} onMouseEnter={() => setSelected(location)} onFocus={() => setSelected(location)} onClick={() => setSelected(location)} aria-label={`${stringValue(location.locationName)}, ${stringValue(location.locationStatus)}`}><span>{stringValue(location.locationName, 'Location')}</span><i /><i /><i /></button>
      })}</div><div className="map-compass"><LocateFixed size={16} /><span>N</span></div></div>
      {chosen && <div className="container-popover" aria-live="polite"><div className="popover-title"><span>Location</span><strong>{stringValue(chosen.displayName || chosen.locationName)}</strong><i className={locationTone(chosen)} /></div><dl><div><dt>Status</dt><dd>{stringValue(chosen.locationStatus)}</dd></div><div><dt>Type</dt><dd>{stringValue(chosen.locationType)}</dd></div><div><dt>Group</dt><dd>{stringValue(chosen.groupName)}</dd></div><div><dt>Activity</dt><dd>{stringValue(chosen.yardActivity || chosen.dockActivity)}</dd></div><div><dt>Carrier</dt><dd>{stringValue(chosen.currentCarrierName)}</dd></div></dl></div>}
      {normalized && !matches.length && <div className="map-empty"><Search size={22} /><strong>No locations found</strong><span>Try another location, group, or carrier.</span></div>}
    </div>
    <aside className="yard-rail"><section className="overview-card"><div className="section-heading"><span><CircleParking size={18} /> Loaded locations</span></div><dl><div><dt>Total on page</dt><dd>{locations.length}</dd></div><div><dt>Occupied</dt><dd>{occupied}</dd></div><div><dt>Available</dt><dd className="success">{available}</dd></div><div><dt>Equipment on page</dt><dd>{equipmentState.data ? equipmentState.data.list.length : 'Loading'}</dd></div></dl></section><section className="quick-card"><div className="section-heading"><span><Search size={18} /> Yard actions</span></div><button type="button" onClick={() => document.getElementById('yard-search')?.focus()}><Search size={17} />Find location</button><button type="button" onClick={() => onUnavailable('Assign location')}><MapPin size={17} />Assign location</button><button type="button" onClick={() => onUnavailable('Move request')}><ArrowLeftRight size={17} />Move request</button><p>Assignments and moves are unavailable in this workspace.</p></section></aside>
  </section>
}

function AlertsView({ state, onRefresh }: { state: AlertsState; onRefresh: () => void }) {
  return <><PageHeader title="Alerts" subtitle="Pending equipment alerts for the selected yard" loading={state.loading} onRefresh={onRefresh} />
    {state.loading && !state.pending.length && !state.configuration.length ? <LoadingState label="Loading alerts..." /> : state.error ? <MessageState icon={AlertTriangle} title="Alerts unavailable" message={state.error} action={<button className="button secondary" type="button" onClick={onRefresh}>Try again</button>} /> : !state.pending.length ? <MessageState icon={Check} title="No pending alerts" message="No equipment alert tasks currently need attention in this yard." /> : <section className="alert-list">{state.pending.map((alert, index) => <article className="data-card" key={stringValue(alert.taskId || alert.id, String(index))}><AlertTriangle size={20} /><div><strong>{stringValue(alert.alertName || alert.name || alert.title, 'Equipment alert')}</strong><span>{stringValue(alert.description || alert.message, 'Review this equipment alert in the source record.')}</span></div><StatusBadge value={alert.status || 'Pending'} /></article>)}</section>}
  </>
}

function flattenReport(value: unknown, prefix = '', rows: [string, string][] = []): [string, string][] {
  if (value === null || value === undefined) return rows
  if (typeof value !== 'object') {
    rows.push([prefix.split('.').map(titleCase).join(' / '), String(value)])
    return rows
  }
  if (Array.isArray(value)) return rows
  Object.entries(value as JsonRecord).forEach(([key, child]) => flattenReport(child, prefix ? `${prefix}.${key}` : key, rows))
  return rows
}

function ReportsView({ state, onRefresh, onToast }: { state: DashboardState; onRefresh: () => void; onToast: (message: string) => void }) {
  const rows = state.data ? flattenReport(state.data) : []
  function download() {
    if (!rows.length) return
    const csv = ['Metric,Value', ...rows.map(([label, value]) => `"${label.replaceAll('"', '""')}","${value.replaceAll('"', '""')}"`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'yard-operational-summary.csv'
    anchor.click()
    URL.revokeObjectURL(url)
    onToast('Operational summary downloaded')
  }
  return <><PageHeader title="Reports" subtitle="Current operational summary from live yard data" loading={state.loading} onRefresh={onRefresh}><button type="button" className="button primary icon-text" onClick={download} disabled={!rows.length || state.loading}><Download size={16} /> Download CSV</button></PageHeader>
    {state.loading && !state.data ? <LoadingState label="Preparing operational summary..." /> : state.error && !state.data ? <MessageState icon={AlertTriangle} title="Report unavailable" message={state.error} action={<button className="button secondary" type="button" onClick={onRefresh}>Try again</button>} /> : rows.length ? <section className="data-card table-card"><DataTable rows={rows.map(([metric, value]) => ({ metric, value }))} columns={[{ label: 'Metric', render: (row) => stringValue(row.metric) }, { label: 'Current value', render: (row) => stringValue(row.value) }]} rowKey={(row) => stringValue(row.metric)} /></section> : <MessageState title="No report data" message="The selected yard did not return an operational summary." />}
  </>
}

function SettingsView({ session, changing, onYardChange }: { session: Session; changing: boolean; onYardChange: (yardId: string) => void }) {
  return <><PageHeader title="Settings" subtitle="Your operational context and display preferences" /><section className="settings-grid"><article className="data-card settings-card"><div className="section-heading"><span><MapPin size={18} /> Yard context</span></div><label htmlFor="settings-yard">Active yard</label><select id="settings-yard" value={session.activeYardId} onChange={(event) => onYardChange(event.target.value)} disabled={changing}>{session.yards.map((yard) => <option value={yard.yardId} key={yard.yardId}>{yard.yardName}</option>)}</select><dl><div><dt>Timezone</dt><dd>{session.timezone}</dd></div><div><dt>Accessible yards</dt><dd>{session.yards.length}</dd></div></dl></article><article className="data-card settings-card"><div className="section-heading"><span><UserRound size={18} /> Account</span></div><dl><div><dt>Signed in as</dt><dd>{session.user.name}</dd></div><div><dt>Access</dt><dd>Read-only operations</dd></div></dl><p>Operational changes are unavailable in this workspace.</p></article></section></>
}

function UnavailableDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="unavailable-title"><button ref={closeRef} type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button><div className="modal-icon"><AlertTriangle size={22} /></div><p className="eyebrow">Read-only workspace</p><h2 id="unavailable-title">{title} is unavailable</h2><p>This action is not available for the selected yard. You can continue reviewing current yard records.</p><div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Close</button></div></section></div>
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('item-yms-theme') as Theme) || 'light')
  const [booting, setBooting] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [dashboard, setDashboard] = useState<DashboardState>({ loading: false, error: '', data: null })
  const [resources, setResources] = useState<Record<ResourceName, ResourceState>>(emptyResources)
  const [alerts, setAlerts] = useState<AlertsState>({ loading: false, error: '', pending: [], configuration: [] })
  const [queries, setQueries] = useState<Record<ResourceName | 'map', string>>({ equipment: '', appointments: '', gates: '', locations: '', map: '' })
  const [selectedLocation, setSelectedLocation] = useState<JsonRecord | null>(null)
  const [toast, setToast] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [changingYard, setChangingYard] = useState(false)
  const [unavailable, setUnavailable] = useState('')

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('item-yms-theme', theme) }, [theme])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(timer) }, [toast])
  useEffect(() => {
    api<Session | { authenticated: false }>('/api/session').then((result) => { if (result.authenticated) setSession(result) }).finally(() => setBooting(false))
  }, [])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (activeNav === 'Yard Management' || activeNav === 'Yard Map') document.getElementById('yard-search')?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [activeNav])

  async function loadDashboard() {
    setDashboard((current) => ({ ...current, loading: true, error: '' }))
    try {
      const response = await api<{ data: JsonRecord }>('/api/yms/dashboard')
      setDashboard({ loading: false, error: '', data: response.data })
    } catch (caught) {
      setDashboard((current) => ({ ...current, loading: false, error: caught instanceof Error ? caught.message : 'Dashboard data is temporarily unavailable.' }))
    }
  }

  async function loadResource(resource: ResourceName, page = 1) {
    setResources((current) => ({ ...current, [resource]: { ...current[resource], loading: true, error: '' } }))
    try {
      const response = await api<{ data: PageResult }>(`/api/yms/${resource}`, { method: 'POST', body: JSON.stringify({ currentPage: page, pageSize: resource === 'locations' ? 48 : 25 }) })
      setResources((current) => ({ ...current, [resource]: { loading: false, error: '', data: response.data } }))
    } catch (caught) {
      setResources((current) => ({ ...current, [resource]: { ...current[resource], loading: false, error: caught instanceof Error ? caught.message : 'This information is temporarily unavailable.' } }))
    }
  }

  async function loadAlerts() {
    setAlerts((current) => ({ ...current, loading: true, error: '' }))
    try {
      const [pending, configuration] = await Promise.all([
        api<{ data: JsonRecord[] }>('/api/yms/alerts/pending'),
        api<{ data: JsonRecord[] }>('/api/yms/alerts/configuration'),
      ])
      setAlerts({ loading: false, error: '', pending: list(pending.data).map(record), configuration: list(configuration.data).map(record) })
    } catch (caught) {
      setAlerts((current) => ({ ...current, loading: false, error: caught instanceof Error ? caught.message : 'Alerts are temporarily unavailable.' }))
    }
  }

  useEffect(() => {
    if (!session) return
    if (activeNav === 'Dashboard' || activeNav === 'Reports') void loadDashboard()
    if (activeNav === 'Yard Management' || activeNav === 'Yard Map') {
      void loadResource('locations')
      void loadResource('equipment')
    }
    if (activeNav === 'Gate Operations') void loadResource('gates')
    if (activeNav === 'Containers') void loadResource('equipment')
    if (activeNav === 'Appointments') void loadResource('appointments')
    if (activeNav === 'Alerts') void loadAlerts()
  }, [activeNav, session?.activeYardId])

  async function changeYard(yardId: string) {
    if (!session || yardId === session.activeYardId) return
    setChangingYard(true)
    try {
      const updated = await api<Session>('/api/context/yard', { method: 'POST', body: JSON.stringify({ yardId }) })
      setResources(emptyResources())
      setDashboard({ loading: false, error: '', data: null })
      setAlerts({ loading: false, error: '', pending: [], configuration: [] })
      setSelectedLocation(null)
      setSession(updated)
      setToast(`${updated.activeYardName} selected`)
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'The yard could not be changed.')
    } finally {
      setChangingYard(false)
    }
  }

  async function logout() {
    setProfileOpen(false)
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* The local session is cleared below. */ }
    setSession(null)
    setResources(emptyResources())
    setDashboard({ loading: false, error: '', data: null })
  }

  const equipmentColumns: Column[] = useMemo(() => [
    { label: 'Equipment', render: (row) => <strong>{stringValue(row.equipmentNo)}</strong> },
    { label: 'Type', render: (row) => stringValue(row.equipmentType) },
    { label: 'Yard status', render: (row) => <StatusBadge value={row.inYard === true ? 'In yard' : row.inYard === false ? 'Outside yard' : null} /> },
    { label: 'Location', render: (row) => stringValue(row.locationName) },
    { label: 'Customer / carrier', render: (row) => <span>{stringValue(row.customerName)}<small>{stringValue(row.carrierName, '')}</small></span> },
    { label: 'Last check-in', render: (row) => formatDate(row.lastCheckInTime, session?.timezone || 'UTC') },
    { label: 'Operation', render: (row) => <StatusBadge value={row.equipmentOperationStatus} /> },
  ], [session?.timezone])
  const appointmentColumns: Column[] = useMemo(() => [
    { label: 'Reference', render: (row) => <strong>{stringValue(row.referenceCode)}</strong> },
    { label: 'Type', render: (row) => stringValue(row.appointmentType) },
    { label: 'Scheduled', render: (row) => formatDate(row.appointmentTime, session?.timezone || 'UTC') },
    { label: 'Carrier / customers', render: (row) => <span>{stringValue(row.carrierName)}<small>{stringValue(row.customerNames, '')}</small></span> },
    { label: 'Status', render: (row) => <StatusBadge value={row.appointmentStatus} /> },
    { label: 'Timeliness', render: (row) => <StatusBadge value={row.timelinessStatus} /> },
    { label: 'Verification', render: (row) => <StatusBadge value={row.verificationStatus} /> },
  ], [session?.timezone])
  const gateColumns: Column[] = [
    { label: 'Gate', render: (row) => <strong>{stringValue(row.gateName)}</strong> },
    { label: 'Lanes', render: (row) => stringValue(row.lanes, list(row.lanes).length ? `${list(row.lanes).length} lanes` : 'Not available') },
    { label: 'Barriers', render: (row) => stringValue(row.barrierTypes) },
    { label: 'Range', render: (row) => numberValue(row.gateRange) === null ? 'Not available' : `${row.gateRange} m` },
    { label: 'Updated', render: (row) => formatDate(row.updatedTime, session?.timezone || 'UTC') },
  ]
  const locationColumns: Column[] = [
    { label: 'Location', render: (row) => <strong>{stringValue(row.displayName || row.locationName)}</strong> },
    { label: 'Type', render: (row) => stringValue(row.locationType) },
    { label: 'Status', render: (row) => <StatusBadge value={row.locationStatus} /> },
    { label: 'Activity', render: (row) => stringValue(row.yardActivity || row.dockActivity) },
    { label: 'Group', render: (row) => stringValue(row.groupName) },
    { label: 'Availability', render: (row) => <StatusBadge value={row.enabled === true ? 'Enabled' : row.enabled === false ? 'Disabled' : null} /> },
  ]

  if (booting) return <main className="boot-screen"><img src="/brand/logo-mark-roundedsquare-fullcolor.svg" alt="Item" /><LoadingState label="Opening Yard Management System..." /></main>
  if (!session) return <Login theme={theme} setTheme={setTheme} onAuthenticated={(authenticated) => { setSession(authenticated); setActiveNav('Dashboard') }} />

  function updateQuery(key: ResourceName | 'map', value: string) {
    setQueries((current) => ({ ...current, [key]: value }))
  }
  function currentContent() {
    if (activeNav === 'Dashboard') return <DashboardView state={dashboard} timezone={session.timezone} onRefresh={loadDashboard} />
    if (activeNav === 'Yard Management' || activeNav === 'Yard Map') return <><PageHeader title={activeNav} subtitle={activeNav === 'Yard Map' ? 'Search and inspect current yard locations' : 'Current location occupancy and yard equipment'} loading={resources.locations.loading || resources.equipment.loading} onRefresh={() => { void loadResource('locations'); void loadResource('equipment') }} /><YardMapView locationState={resources.locations} equipmentState={resources.equipment} query={queries.map} setQuery={(value) => updateQuery('map', value)} selected={selectedLocation} setSelected={setSelectedLocation} onRefresh={() => void loadResource('locations')} onUnavailable={setUnavailable} /></>
    if (activeNav === 'Gate Operations') return <ResourceView title="Gate Operations" subtitle="Gate definitions and lane availability" resource="gates" state={resources.gates} timezone={session.timezone} query={queries.gates} setQuery={(value) => updateQuery('gates', value)} columns={gateColumns} rowKey={(row, index) => stringValue(row.gateId, String(index))} onPage={loadResource} onRefresh={() => void loadResource('gates')} note="Gate control actions are unavailable in this read-only workspace." />
    if (activeNav === 'Containers') return <ResourceView title="Containers" subtitle="Equipment currently available to this yard context" resource="equipment" state={resources.equipment} timezone={session.timezone} query={queries.equipment} setQuery={(value) => updateQuery('equipment', value)} columns={equipmentColumns} rowKey={(row, index) => stringValue(row.equipmentId, String(index))} onPage={loadResource} onRefresh={() => void loadResource('equipment')} note="Equipment moves and assignments are unavailable in this read-only workspace." />
    if (activeNav === 'Appointments') return <ResourceView title="Appointments" subtitle="Scheduled yard activity and check-in progress" resource="appointments" state={resources.appointments} timezone={session.timezone} query={queries.appointments} setQuery={(value) => updateQuery('appointments', value)} columns={appointmentColumns} rowKey={(row, index) => stringValue(row.appointmentId, String(index))} onPage={loadResource} onRefresh={() => void loadResource('appointments')} note="Appointment changes are unavailable in this read-only workspace." />
    if (activeNav === 'Reports') return <ReportsView state={dashboard} onRefresh={loadDashboard} onToast={setToast} />
    if (activeNav === 'Alerts') return <AlertsView state={alerts} onRefresh={loadAlerts} />
    return <SettingsView session={session} changing={changingYard} onYardChange={changeYard} />
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><img src="/brand/item-logo-fullcolor-blacktxt.svg" alt="Item" className="brand-logo light-logo" /><img src="/brand/item-white-logo.svg" alt="Item" className="brand-logo dark-logo" /><div className="header-rule" /><div><h1>Yard Management System <span>(YMS)</span></h1><p>{session.activeYardName}</p></div></div>
      <div className="header-capabilities" aria-label="Current yard context"><MapPin /><div><strong>{session.activeYardName}</strong><span>{session.timezone}</span></div>{session.yards.length > 1 && <label className="yard-select"><span className="sr-only">Active yard</span><select value={session.activeYardId} onChange={(event) => changeYard(event.target.value)} disabled={changingYard}>{session.yards.map((yard) => <option value={yard.yardId} key={yard.yardId}>{yard.yardName}</option>)}</select><ChevronDown size={15} /></label>}</div>
      <div className="top-actions"><span className="presentation-badge"><i /> Connected</span><ThemeControl theme={theme} setTheme={setTheme} /><div className="profile-wrap"><button className="profile-button" type="button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}><span className="avatar">{initials(session.user.name)}</span><span><strong>{session.user.name}</strong><small>Yard operations</small></span><ChevronDown size={15} /></button>{profileOpen && <div className="profile-menu" role="menu"><button type="button" onClick={() => { setActiveNav('Settings'); setProfileOpen(false) }}><UserRound size={15} /> Account settings</button><button type="button" onClick={logout}><LogOut size={15} /> Sign out</button></div>}</div></div>
    </header>
    <aside className="sidebar"><nav aria-label="Main navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} type="button" className={activeNav === label ? 'active' : ''} onClick={() => setActiveNav(label)} aria-current={activeNav === label ? 'page' : undefined}><Icon size={21} /><span>{label}</span>{label === 'Alerts' && alerts.pending.length > 0 && <i className="alert-dot" />}</button>)}</nav><div className="sidebar-art" aria-hidden="true"><div className="stack stack-1" /><div className="stack stack-2" /><div className="stack stack-3" /></div><div className="sidebar-footer"><img src="/brand/item-white-logo.svg" alt="Item" /><p>Moving a smarter<br />supply chain forward.</p></div></aside>
    <main className="dashboard">{currentContent()}</main>
    <footer className="feature-strip"><div><Home /><p><strong>Yard Overview</strong><span>Capacity · Equipment · Dwell</span></p></div><div><MapPin /><p><strong>Location Visibility</strong><span>Yard spots · Docks · Activity</span></p></div><div><Container /><p><strong>Equipment Directory</strong><span>Containers · Trailers · Tractors</span></p></div><div><CalendarDays /><p><strong>Appointment Schedule</strong><span>Inbound · Outbound · Status</span></p></div><img src="/brand/item-white-logo.svg" alt="Item" /></footer>
    {unavailable && <UnavailableDialog title={unavailable} onClose={() => setUnavailable('')} />}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </div>
}

export default App
