import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, type SyncedSession, type TranscriptTurn, type User } from '../api'
import type { SessionDraft } from '../domain/session'
import { theme as T } from '../theme'

export function InterviewSession({ session, draft, user, onEnd }: {
  session: SyncedSession
  draft: SessionDraft
  user: User
  onEnd: (updated: SyncedSession) => void
}) {
  const mockMode = draft.mode === 'mock'
  const [turns, setTurns] = useState<TranscriptTurn[]>([])
  const turnsRef = useRef<TranscriptTurn[]>([])
  const [input, setInput] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  const setTranscript = (next: TranscriptTurn[]) => { turnsRef.current = next; setTurns(next) }
  const profile = {
    name: user.name,
    targetRole: draft.role,
    targetCompany: draft.company,
    customPrompt: draft.customInstructions,
    language: 'English',
  }

  const contextFor = async (query: string) => {
    if (!draft.selectedDocumentIds.length) return ''
    try { return (await api.documentContext(query, draft.selectedDocumentIds)).context }
    catch { return '' }
  }

  const nextQuestion = async (current: TranscriptTurn[]) => {
    setBusy(true); setError('')
    try {
      const query = [...current].reverse().find(turn => turn.role === 'interviewer')?.text || `${draft.company} ${draft.role} ${draft.objective}`
      const extraContext = await contextFor(query)
      const { turn } = await api.nextInterviewTurn({
        config: { domainLabel: draft.role, roundLabel: 'Mobile mock', focus: draft.objective, followupDepth: 'normal', relentless: false },
        transcript: current,
        profile,
        language: 'English',
        ...(extraContext ? { extraContext } : {}),
      })
      const next = [...current, { role: 'interviewer' as const, text: turn.say, kind: turn.kind || 'question', ts: Date.now() }]
      setTranscript(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the next question.') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (mockMode && !started.current) { started.current = true; nextQuestion([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submitMockAnswer = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const next = [...turnsRef.current, { role: 'candidate' as const, text, kind: 'answer' as const, ts: Date.now() }]
    setTranscript(next)
    await nextQuestion(next)
  }

  const generateAnswer = async () => {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true); setError(''); setAnswer('')
    try {
      const extraContext = await contextFor(text)
      const { hint } = await api.hint({
        question: text,
        profile,
        conversationHistory: turnsRef.current.slice(-8),
        language: 'English',
        style: draft.responseStyle,
        autoSkip: false,
        ...(extraContext ? { extraContext } : {}),
      })
      const response = hint.fullAnswer || hint.sampleAnswer || hint.opener || (hint.keyPoints || []).join('\n')
      if (!response) throw new Error('No answer was returned. Try rephrasing the question.')
      setAnswer(response)
      setTranscript([...turnsRef.current,
        { role: 'interviewer', text, kind: 'question', ts: Date.now() },
        { role: 'assistant', text: response, kind: 'answer', ts: Date.now() },
      ])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not generate an answer.') }
    finally { setBusy(false) }
  }

  const end = async () => {
    setBusy(true); setError('')
    try { onEnd((await api.updateSession(session._id, turnsRef.current)).session) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this session.') }
    finally { setBusy(false) }
  }

  const currentQuestion = [...turns].reverse().find(turn => turn.role === 'interviewer')?.text

  return <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.topbar}><View style={styles.topTitle}><Text style={styles.eyebrow}>{mockMode ? 'VOICE PRACTICE · TEXT BETA' : 'ANSWER ASSIST · TEXT BETA'}</Text><Text style={styles.title}>{session.title}</Text></View><Pressable accessibilityRole="button" onPress={end} disabled={busy}><Text style={styles.end}>End</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {mockMode ? <>
        <View style={styles.questionCard}><Text style={styles.label}>INTERVIEWER</Text>{currentQuestion ? <Text style={styles.question}>{currentQuestion}</Text> : <Text style={styles.muted}>Preparing your first question…</Text>}</View>
        {turns.filter(turn => turn.role === 'candidate').length > 0 && <Text style={styles.progress}>{turns.filter(turn => turn.role === 'candidate').length} answers completed</Text>}
      </> : <>
        <Text style={styles.intro}>Type the exact question you heard. MockMate applies this attempt’s playbook and only the documents you selected.</Text>
        <TextInput accessibilityLabel="Interview question" value={question} onChangeText={setQuestion} placeholder="What did the interviewer ask?" placeholderTextColor={T.subtle} multiline textAlignVertical="top" style={[styles.input, styles.questionInput]} />
        <Pressable accessibilityRole="button" onPress={generateAnswer} disabled={!question.trim() || busy} style={[styles.button, (!question.trim() || busy) && styles.disabled]}><Text style={styles.buttonText}>Generate answer</Text></Pressable>
        {!!answer && <View style={styles.answerCard}><Text style={styles.label}>SUGGESTED ANSWER</Text><Text selectable style={styles.answer}>{answer}</Text></View>}
      </>}
      {!!error && <View style={styles.errorCard}><Text style={styles.error}>{error}</Text></View>}
      {busy && <ActivityIndicator color={T.accent} />}
    </ScrollView>
    {mockMode && <View style={styles.composer}><TextInput accessibilityLabel="Your answer" value={input} onChangeText={setInput} placeholder="Answer in your own words…" placeholderTextColor={T.subtle} multiline style={styles.composerInput} /><Pressable accessibilityRole="button" onPress={submitMockAnswer} disabled={!input.trim() || busy || !currentQuestion} style={[styles.send, (!input.trim() || busy || !currentQuestion) && styles.disabled]}><Text style={styles.sendText}>Continue</Text></Pressable></View>}
  </KeyboardAvoidingView>
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg }, topbar: { flexDirection: 'row', alignItems: 'center', borderBottomColor: T.border, borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 14 }, topTitle: { flex: 1, gap: 3 }, eyebrow: { color: T.accent, fontSize: 10, letterSpacing: 1.4, fontWeight: '800' }, title: { color: T.text, fontSize: 17, fontWeight: '800' }, end: { color: T.danger, padding: 10, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 120, gap: 16 }, questionCard: { backgroundColor: T.surface, borderColor: 'rgba(20,184,166,0.28)', borderWidth: 1, borderRadius: T.radius, padding: 20, gap: 10 }, label: { color: T.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 }, question: { color: T.text, fontSize: 21, lineHeight: 30, fontWeight: '700' }, muted: { color: T.muted, lineHeight: 20 }, progress: { color: T.subtle, textAlign: 'center' }, intro: { color: T.muted, lineHeight: 21 },
  input: { color: T.text, backgroundColor: T.surface, borderColor: T.borderStrong, borderWidth: 1, borderRadius: T.controlRadius, paddingHorizontal: 15, paddingVertical: 14, fontSize: 16 }, questionInput: { minHeight: 110 }, button: { minHeight: 52, backgroundColor: T.accent, borderRadius: T.controlRadius, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#041311', fontWeight: '800' }, disabled: { opacity: 0.4 }, answerCard: { backgroundColor: 'rgba(20,184,166,0.07)', borderColor: 'rgba(20,184,166,0.28)', borderWidth: 1, borderRadius: T.radius, padding: 18, gap: 10 }, answer: { color: T.text, fontSize: 16, lineHeight: 24 }, errorCard: { backgroundColor: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.3)', borderWidth: 1, borderRadius: T.controlRadius, padding: 13 }, error: { color: '#FDA4AF' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, borderTopColor: T.border, borderTopWidth: 1, backgroundColor: T.surface, padding: 12 }, composerInput: { flex: 1, maxHeight: 110, color: T.text, backgroundColor: T.elevated, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }, send: { backgroundColor: T.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' }, sendText: { color: '#041311', fontWeight: '800' },
})
