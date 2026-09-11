import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { api, apiConfigured, type Account, type SyncedSession } from './src/api'
import { normalizePairCode, sessionTitle, validateSessionDraft } from './src/domain/session'
import { theme as T } from './src/theme'

type Tab = 'prepare' | 'history' | 'duo' | 'account'
type Mode = 'live' | 'mock' | 'coding'

const tabs: { key: Tab; icon: string; label: string }[] = [
  { key: 'prepare', icon: '⌂', label: 'Prepare' },
  { key: 'history', icon: '◷', label: 'History' },
  { key: 'duo', icon: '◎', label: 'Duo' },
  { key: 'account', icon: '○', label: 'Account' },
]

export default function App() {
  const [booting, setBooting] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [account, setAccount] = useState<Account | null>(null)

  const loadAccount = useCallback(async () => {
    if (!await api.hasToken()) return setAuthenticated(false)
    try {
      const next = await api.account()
      setAccount(next)
      setAuthenticated(true)
    } catch {
      setAuthenticated(false)
    }
  }, [])

  useEffect(() => { loadAccount().finally(() => setBooting(false)) }, [loadAccount])

  if (booting) return <Centered><ActivityIndicator color={T.accent} /></Centered>
  if (!authenticated) return <AuthScreen onAuthenticated={async () => { await loadAccount() }} />
  return <MainApp account={account} onAccount={setAccount} onSignedOut={() => setAuthenticated(false)} />
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [signup, setSignup] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (signup) await api.signup(name.trim(), email.trim(), password)
      else await api.login(email.trim(), password)
      await onAuthenticated()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not continue.') }
    finally { setBusy(false) }
  }

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.logo}><Text style={styles.logoText}>M</Text></View>
      <Text style={styles.brand}>MockMate</Text>
      <Text style={styles.tagline}>Prepare with evidence. Improve every round.</Text>
      {!apiConfigured() && <Banner text="Set EXPO_PUBLIC_API_BASE to your hosted HTTPS backend before signing in." />}
      {signup && <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" />}
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label={signup ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} disabled={!email || !password || (signup && !name)} />
      <Pressable onPress={() => { setSignup(v => !v); setError('') }}><Text style={styles.authSwitch}>{signup ? 'Already have an account? Sign in' : 'New to MockMate? Create account'}</Text></Pressable>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function MainApp({ account, onAccount, onSignedOut }: { account: Account | null; onAccount: (a: Account | null) => void; onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('prepare')
  const [sessions, setSessions] = useState<SyncedSession[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true); setHistoryError('')
    try { setSessions((await api.sessions()).sessions) }
    catch (e) { setHistoryError(e instanceof Error ? e.message : 'Could not load history.') }
    finally { setLoadingHistory(false) }
  }, [])

  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <View style={styles.app}>
      {tab === 'prepare' && <PrepareScreen onCreated={(s) => { setSessions(old => [s, ...old]); setTab('history') }} />}
      {tab === 'history' && <HistoryScreen sessions={sessions} loading={loadingHistory} error={historyError} onRefresh={loadHistory} />}
      {tab === 'duo' && <DuoScreen />}
      {tab === 'account' && <AccountScreen account={account} onRefresh={async () => { const a = await api.account(); onAccount(a) }} onSignedOut={onSignedOut} />}
      <View style={styles.tabBar}>{tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} onPress={() => setTab(item.key)} style={styles.tab}>
        <Text style={[styles.tabIcon, tab === item.key && styles.tabActive]}>{item.icon}</Text>
        <Text style={[styles.tabLabel, tab === item.key && styles.tabActive]}>{item.label}</Text>
      </Pressable>)}</View>
    </View>
  </SafeAreaView>
}

function PrepareScreen({ onCreated }: { onCreated: (session: SyncedSession) => void }) {
  const [mode, setMode] = useState<Mode>('mock')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [objective, setObjective] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = useMemo(() => validateSessionDraft({ mode, company, role, objective }), [mode, company, role, objective])

  const create = async () => {
    if (!validation.valid) return setError(Object.values(validation.errors)[0] as string)
    setBusy(true); setError('')
    try {
      const payload = { ...validation.draft, title: sessionTitle(validation.draft) }
      onCreated((await api.createSession(payload)).session)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create session.') }
    finally { setBusy(false) }
  }

  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Header eyebrow="MOBILE COMPANION" title="Prepare your next round" subtitle="Set the goal now. Voice practice and desktop pairing arrive in the next milestone." />
    <View style={styles.segment}>{(['live', 'mock', 'coding'] as Mode[]).map(value => <Pressable key={value} onPress={() => { setMode(value); setError('') }} style={[styles.segmentItem, mode === value && styles.segmentSelected]}>
      <Text style={[styles.segmentText, mode === value && styles.segmentTextSelected]}>{value === 'coding' ? '</> Coding' : value === 'live' ? '◉ Live' : '▣ Mock'}</Text>
    </Pressable>)}</View>
    <Field label="Company" value={company} onChangeText={setCompany} placeholder={mode === 'live' ? 'Required for Live' : 'Optional'} />
    <Field label="Role" value={role} onChangeText={setRole} placeholder="e.g. Senior Software Engineer" />
    <Field label="Objective" value={objective} onChangeText={setObjective} placeholder="What should this session focus on?" multiline />
    <Pressable style={styles.advancedHeader} onPress={() => setAdvanced(v => !v)}><Text style={styles.cardTitle}>Advanced setup</Text><Text style={styles.muted}>{advanced ? '⌃' : '⌄'}</Text></Pressable>
    {advanced && <View style={styles.card}>
      <SettingRow title="Scenario" value={mode === 'coding' ? 'Coding interview' : mode === 'live' ? 'Live interview' : 'General mock'} />
      <SettingRow title="Documents" value="Add after hosted sync" />
      <SettingRow title="Answer style" value="Concise" />
      <SettingRow title="Audio input" value="Microphone · M1" last />
    </View>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    <PrimaryButton label="Create session goal" onPress={create} busy={busy} disabled={!validation.valid} />
  </ScrollView>
}

function HistoryScreen({ sessions, loading, error, onRefresh }: { sessions: SyncedSession[]; loading: boolean; error: string; onRefresh: () => void }) {
  return <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={T.accent} />}>
    <Header eyebrow="YOUR PROGRESS" title="Session history" subtitle="Cross-device history comes from your hosted MockMate account." />
    {!!error && <Banner text={error} />}
    {!loading && !error && sessions.length === 0 && <Empty title="No sessions yet" body="Create a job goal from Prepare. Your completed practice and companion sessions will appear here." />}
    {sessions.map(session => <View key={session._id} style={styles.sessionCard}>
      <View style={styles.rowBetween}><Text style={styles.cardTitle}>{session.title || sessionTitle(session)}</Text><Pill label={session.mode.toUpperCase()} /></View>
      <Text style={styles.muted}>{[session.company, session.role].filter(Boolean).join(' · ') || 'Interview practice'}</Text>
      <Text style={styles.sessionDate}>{new Date(session.createdAt).toLocaleString()}</Text>
    </View>)}
  </ScrollView>
}

function DuoScreen() {
  const [pairCode, setPairCode] = useState('')
  const [message, setMessage] = useState('')
  const invite = 'https://app.mockmate.ai/duo'
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Header eyebrow="SECOND DEVICE" title="MockMate Duo" subtitle="Pair a trusted helper or your own phone with a desktop session." />
    <View style={styles.card}><Text style={styles.step}>1  Start MockMate on desktop</Text><Text style={styles.step}>2  Generate a short-lived pairing link</Text><Text style={styles.step}>3  Review and grant each permission</Text></View>
    <View style={styles.consentCard}><Text style={styles.cardTitle}>Permission model</Text><SettingRow title="View transcript & screen" value="Separate consent" /><SettingRow title="Send hints" value="Separate consent" /><SettingRow title="Remote control" value="Off by default" last /></View>
    <PrimaryButton label="Share Duo invitation" onPress={async () => { await Share.share({ title: 'Join my MockMate Duo session', message: `Join my MockMate Duo session: ${invite}` }) }} />
    <Field label="Or enter a pairing code" value={pairCode} onChangeText={v => { setPairCode(normalizePairCode(v)); setMessage('') }} placeholder="AB12CD34" autoCapitalize="characters" />
    <PrimaryButton variant="secondary" label="Join paired session" disabled={pairCode.length < 6} onPress={() => setMessage('Pairing transport is planned for M2; the input contract is ready.')} />
    {!!message && <Banner text={message} />}
  </ScrollView>
}

function AccountScreen({ account, onRefresh, onSignedOut }: { account: Account | null; onRefresh: () => Promise<void>; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false)
  const seconds = account?.usage?.sttSeconds || 0
  const cap = account?.limits?.sttSeconds
  return <ScrollView contentContainerStyle={styles.page}>
    <Header eyebrow="ACCOUNT" title={account?.user.name || 'MockMate user'} subtitle={account?.user.email || ''} />
    <View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{(account?.user.name || account?.user.email || 'M')[0]?.toUpperCase()}</Text></View><View><Pill label={(account?.plan || 'free').toUpperCase()} /><Text style={styles.muted}>Shared account</Text></View></View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Current-period usage</Text>
      <Metric label="AI responses" value={`${account?.usage?.llmCalls || 0}${account?.limits?.llmCalls == null ? '' : ` / ${account.limits.llmCalls}`}`} />
      <Metric label="Transcription" value={`${Math.round(seconds / 60)} min${cap == null ? '' : ` / ${Math.round(cap / 60)} min`}`} />
    </View>
    <PrimaryButton variant="secondary" label="Refresh account" onPress={async () => { setBusy(true); try { await onRefresh() } finally { setBusy(false) } }} busy={busy} />
    <PrimaryButton variant="danger" label="Sign out" onPress={async () => { setBusy(true); try { await api.logout(); onSignedOut() } finally { setBusy(false) } }} />
  </ScrollView>
}

function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <View style={styles.header}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, multiline, ...inputProps } = props
  return <View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput {...inputProps} multiline={multiline} placeholderTextColor={T.subtle} style={[styles.input, multiline && styles.multiline]} /></View>
}

function PrimaryButton({ label, onPress, disabled, busy, variant = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'secondary' | 'danger' }) {
  return <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={[styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'danger' && styles.buttonDanger, (disabled || busy) && styles.buttonDisabled]}>
    {busy ? <ActivityIndicator color={T.text} /> : <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText]}>{label}</Text>}
  </Pressable>
}

function SettingRow({ title, value, last }: { title: string; value: string; last?: boolean }) { return <View style={[styles.setting, last && styles.settingLast]}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.muted}>{value}</Text></View> }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View> }
function Pill({ label }: { label: string }) { return <View style={styles.pill}><Text style={styles.pillText}>{label}</Text></View> }
function Banner({ text }: { text: string }) { return <View style={styles.banner}><Text style={styles.bannerText}>{text}</Text></View> }
function Empty({ title, body }: { title: string; body: string }) { return <View style={styles.empty}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></View> }
function Centered({ children }: { children: React.ReactNode }) { return <SafeAreaView style={styles.centered}><StatusBar style="light" />{children}</SafeAreaView> }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg },
  authWrap: { flex: 1, justifyContent: 'center', padding: 28, gap: 16 }, logo: { width: 62, height: 62, borderRadius: 20, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, logoText: { color: '#041311', fontSize: 32, fontWeight: '900' },
  brand: { color: T.text, fontSize: 32, fontWeight: '800', textAlign: 'center' }, tagline: { color: T.muted, fontSize: 15, textAlign: 'center', marginBottom: 12 }, authSwitch: { color: T.accent, textAlign: 'center', fontWeight: '700', padding: 8 },
  app: { flex: 1 }, page: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120, gap: 16 }, header: { gap: 5, marginBottom: 4 }, eyebrow: { color: T.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2 }, title: { color: T.text, fontSize: 28, fontWeight: '800' }, subtitle: { color: T.muted, fontSize: 15, lineHeight: 21 },
  segment: { flexDirection: 'row', padding: 5, backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: 999 }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999 }, segmentSelected: { backgroundColor: 'rgba(20,184,166,0.16)', borderColor: T.accentDeep, borderWidth: 1 }, segmentText: { color: T.muted, fontWeight: '700' }, segmentTextSelected: { color: T.accent },
  fieldWrap: { gap: 7 }, label: { color: T.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 }, input: { color: T.text, backgroundColor: T.surface, borderColor: T.borderStrong, borderWidth: 1, borderRadius: T.controlRadius, paddingHorizontal: 15, paddingVertical: 14, fontSize: 16 }, multiline: { minHeight: 90, textAlignVertical: 'top' },
  button: { minHeight: 54, borderRadius: T.controlRadius, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }, buttonSecondary: { backgroundColor: 'transparent', borderColor: T.accent, borderWidth: 1 }, buttonDanger: { backgroundColor: 'rgba(244,63,94,0.14)', borderColor: 'rgba(244,63,94,0.42)', borderWidth: 1 }, buttonDisabled: { opacity: 0.42 }, buttonText: { color: '#041311', fontSize: 16, fontWeight: '800' }, buttonSecondaryText: { color: T.accent },
  advancedHeader: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.controlRadius, padding: 17 }, card: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, padding: 18, gap: 2 }, consentCard: { backgroundColor: 'rgba(20,184,166,0.07)', borderColor: 'rgba(20,184,166,0.25)', borderWidth: 1, borderRadius: T.radius, padding: 18, gap: 4 }, cardTitle: { color: T.text, fontSize: 17, fontWeight: '800' }, muted: { color: T.muted, fontSize: 14, lineHeight: 20 }, error: { color: T.danger, fontSize: 14 },
  setting: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.border }, settingLast: { borderBottomWidth: 0 }, settingTitle: { color: T.text, fontSize: 15, fontWeight: '700' }, step: { color: T.text, fontSize: 15, lineHeight: 28 },
  sessionCard: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, padding: 18, gap: 8 }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, sessionDate: { color: T.subtle, fontSize: 12 }, pill: { borderRadius: 999, borderColor: T.accentDeep, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(20,184,166,0.10)' }, pillText: { color: T.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, padding: 18 }, avatar: { width: 58, height: 58, borderRadius: 18, backgroundColor: T.accentDeep, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: T.text, fontSize: 26, fontWeight: '800' }, metric: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomColor: T.border, borderBottomWidth: 1 }, metricValue: { color: T.text, fontWeight: '800' },
  banner: { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.30)', borderWidth: 1, borderRadius: T.controlRadius, padding: 13 }, bannerText: { color: '#FCD34D', lineHeight: 20 }, empty: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, padding: 24, gap: 7, alignItems: 'center' },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: 'rgba(8,8,12,0.98)', borderTopColor: T.border, borderTopWidth: 1, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 10 : 12 }, tab: { flex: 1, alignItems: 'center', gap: 2 }, tabIcon: { color: T.subtle, fontSize: 23 }, tabLabel: { color: T.subtle, fontSize: 10, fontWeight: '700' }, tabActive: { color: T.accent },
})
