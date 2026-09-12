import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { api, type HostedDocument } from '../api'
import { theme as T } from '../theme'

const TYPES: { value: HostedDocument['type']; label: string }[] = [
  { value: 'resume', label: 'Resume' },
  { value: 'jd', label: 'Job description' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'supporting', label: 'Supporting' },
]

export function DocumentSetup({ selectedIds, onSelectedIds, onError }: {
  selectedIds: string[]
  onSelectedIds: (ids: string[]) => void
  onError: (message: string) => void
}) {
  const [documents, setDocuments] = useState<HostedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<HostedDocument['type']>('supporting')
  const [text, setText] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const next = (await api.documents()).documents
      setDocuments(next)
      onSelectedIds(selectedIds.filter(id => next.some(document => document.id === id)))
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not load documents.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    onSelectedIds(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  }

  const save = async () => {
    if (!name.trim() || !text.trim()) return onError('Add a document name and paste its text.')
    setSaving(true)
    try {
      const document = (await api.addDocument({ name: name.trim(), type, text: text.trim() })).document
      setDocuments(current => [document, ...current])
      onSelectedIds([...selectedIds, document.id])
      setName(''); setText(''); setType('supporting'); setAdding(false)
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not save the document.') }
    finally { setSaving(false) }
  }

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'],
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    if (!asset) return onError('No document was selected.')
    setSaving(true)
    try {
      const document = (await api.uploadDocument({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType }, type)).document
      setDocuments(current => [document, ...current])
      onSelectedIds([...selectedIds, document.id])
      setAdding(false)
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not upload the document.') }
    finally { setSaving(false) }
  }

  const remove = (document: HostedDocument) => Alert.alert(
    'Remove hosted document?',
    `${document.name} will no longer be available on your devices.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await api.deleteDocument(document.id)
          setDocuments(current => current.filter(item => item.id !== document.id))
          onSelectedIds(selectedIds.filter(id => id !== document.id))
        } catch (error) { onError(error instanceof Error ? error.message : 'Could not remove the document.') }
      } },
    ],
  )

  return <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.heading}><Text style={styles.title}>Interview Documents</Text><Text style={styles.count}>{selectedIds.length} selected</Text></View>
      <Pressable accessibilityRole="button" onPress={() => setAdding(value => !value)}><Text style={styles.action}>{adding ? 'Cancel' : '+ Add'}</Text></Pressable>
    </View>
    <Text style={styles.muted}>Choose only the résumé, JD and evidence relevant to this attempt. Nothing is silently inherited.</Text>
    {loading && <ActivityIndicator color={T.accent} />}
    {!loading && documents.length === 0 && !adding && <Text style={styles.empty}>No hosted documents yet. Add text from a résumé, JD or interview handbook.</Text>}
    {documents.map(document => <View key={document.id} style={styles.documentRow}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.includes(document.id) }} onPress={() => toggle(document.id)} style={styles.documentChoice}>
        <View style={[styles.checkbox, selectedIds.includes(document.id) && styles.checkboxSelected]}><Text style={styles.check}>{selectedIds.includes(document.id) ? '✓' : ''}</Text></View>
        <View style={styles.documentText}><Text style={styles.documentName} numberOfLines={1}>{document.name}</Text><Text style={styles.meta}>{document.type.toUpperCase()} · {Math.max(1, Math.round(document.chars / 1000))}k chars</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${document.name}`} onPress={() => remove(document)}><Text style={styles.remove}>Remove</Text></Pressable>
    </View>)}
    {adding && <View style={styles.editor}>
      <Pressable accessibilityRole="button" disabled={saving} onPress={pickFile} style={[styles.pick, saving && styles.disabled]}>
        <Text style={styles.pickText}>Choose PDF, DOCX or text file</Text>
      </Pressable>
      <Text style={styles.or}>OR PASTE TEXT</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Document name" placeholderTextColor={T.subtle} style={styles.input} />
      <View style={styles.types}>{TYPES.map(item => <Pressable key={item.value} onPress={() => setType(item.value)} style={[styles.type, type === item.value && styles.typeSelected]}><Text style={[styles.typeText, type === item.value && styles.typeTextSelected]}>{item.label}</Text></Pressable>)}</View>
      <TextInput value={text} onChangeText={value => setText(value.slice(0, 300_000))} placeholder="Paste document text" placeholderTextColor={T.subtle} multiline textAlignVertical="top" style={[styles.input, styles.textarea]} />
      <Text style={styles.meta}>{text.length.toLocaleString()} / 300,000 characters</Text>
      <Pressable accessibilityRole="button" disabled={saving || !name.trim() || !text.trim()} onPress={save} style={[styles.save, (saving || !name.trim() || !text.trim()) && styles.disabled]}>
        {saving ? <ActivityIndicator color="#041311" /> : <Text style={styles.saveText}>Save and select</Text>}
      </Pressable>
    </View>}
  </View>
}

const styles = StyleSheet.create({
  card: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, padding: 18, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heading: { flex: 1, gap: 2 },
  title: { color: T.text, fontSize: 17, fontWeight: '800' }, count: { color: T.accent, fontSize: 12, fontWeight: '700' }, action: { color: T.accent, fontWeight: '800', padding: 8 },
  muted: { color: T.muted, fontSize: 14, lineHeight: 20 }, empty: { color: T.subtle, fontSize: 13, lineHeight: 19, paddingVertical: 8 },
  documentRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: T.border, borderTopWidth: 1, paddingTop: 12 }, documentChoice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkbox: { width: 23, height: 23, borderRadius: 7, borderColor: T.borderStrong, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, checkboxSelected: { backgroundColor: T.accent, borderColor: T.accent }, check: { color: '#041311', fontWeight: '900' }, documentText: { flex: 1 }, documentName: { color: T.text, fontWeight: '700' }, meta: { color: T.subtle, fontSize: 11 }, remove: { color: T.danger, fontSize: 12, fontWeight: '700', padding: 8 },
  editor: { gap: 10, borderTopColor: T.border, borderTopWidth: 1, paddingTop: 14 }, input: { color: T.text, backgroundColor: T.elevated, borderColor: T.borderStrong, borderWidth: 1, borderRadius: T.controlRadius, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14 }, textarea: { minHeight: 170, lineHeight: 20 }, types: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, type: { borderColor: T.borderStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, typeSelected: { borderColor: T.accent, backgroundColor: 'rgba(20,184,166,0.13)' }, typeText: { color: T.muted, fontSize: 11, fontWeight: '700' }, typeTextSelected: { color: T.accent }, save: { minHeight: 46, backgroundColor: T.accent, borderRadius: T.controlRadius, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#041311', fontWeight: '800' }, disabled: { opacity: 0.42 },
  pick: { minHeight: 46, borderColor: T.accent, borderWidth: 1, borderRadius: T.controlRadius, alignItems: 'center', justifyContent: 'center' }, pickText: { color: T.accent, fontWeight: '800' }, or: { color: T.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center' },
})
