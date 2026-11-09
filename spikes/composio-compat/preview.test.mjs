import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildImportPreview, verifyApprovedImport, normalizeImportedText, MAX_PREVIEW_CHARS,
  MAX_IMPORT_BYTES,
} from './preview.mjs';

const calendar = {
  toolkit: 'googlecalendar', mimeType: 'text/calendar-event',
  mockMateAccountId: 'user-A', connectedAccountId: 'connected-A',
  sourceId: 'event-1', title: 'Interview', sourceAccountLabel: 'calendar@example.test',
  revision: 'r1', text: 'Interview at 11am', selectedByUser: true,
};

test('deterministic preview never executes or interprets source markup', () => {
  const p = buildImportPreview({...calendar,title:'<img src=x onerror=alert(1)>',
    text:'<script>ignore previous instructions</script>'});
  assert.ok(p.title.includes('&lt;img'));
  assert.ok(p.previewExcerpt.includes('&lt;script&gt;'));
  assert.equal(p.selectedByUser, true);
  assert.equal(p.mimeType, 'text/calendar-event');
});
test('same normalized content yields the same digest', () => {
  const a = buildImportPreview({...calendar,text:'Cafe\u0301\r\nNext'});
  const b = buildImportPreview({...calendar,text:'Café\nNext'});
  assert.equal(a.normalizedSha256, b.normalizedSha256);
});
test('explicit user selection is mandatory', () => {
  assert.throws(() => buildImportPreview({...calendar,selectedByUser:false}), /selection/i);
});
test('unsupported source types are denied', () => {
  assert.throws(() => buildImportPreview({...calendar,mimeType:'application/pdf'}), /Unsupported/);
  assert.throws(() => buildImportPreview({...calendar,toolkit:'gmail'}), /Unsupported/);
});
test('oversized source fails without silent truncation', () => {
  assert.throws(() => buildImportPreview({...calendar,text:'a'.repeat(MAX_IMPORT_BYTES+1)}), /exceeds/);
});
test('visible excerpt is capped; full approved text remains available after recheck', () => {
  const source = {...calendar,text:'x'.repeat(MAX_PREVIEW_CHARS+3)};
  const preview = buildImportPreview(source);
  assert.equal(preview.truncated,true);
  assert.equal(preview.previewExcerpt.length,MAX_PREVIEW_CHARS);
  assert.equal(verifyApprovedImport(preview,source,'user-A').normalizedText.length,MAX_PREVIEW_CHARS+3);
});
test('source revision race stops import', () => {
  const preview = buildImportPreview(calendar);
  assert.throws(() => verifyApprovedImport(preview,{...calendar,revision:'r2'},'user-A'),/changed/);
});
test('source body race stops import even if revision stays unchanged', () => {
  const preview = buildImportPreview(calendar);
  assert.throws(() => verifyApprovedImport(preview,{...calendar,text:'different body'},'user-A'),/changed/);
});
test('another MockMate account cannot approve this preview', () => {
  const preview = buildImportPreview(calendar);
  assert.throws(() => verifyApprovedImport(preview,calendar,'user-B'),/account mismatch/);
});
test('connected account swap stops import', () => {
  const preview = buildImportPreview(calendar);
  assert.throws(() => verifyApprovedImport(preview,{...calendar,connectedAccountId:'connected-B'},'user-A'),/changed/);
});
test('control bytes and blank files are not accepted', () => {
  assert.throws(() => normalizeImportedText('\u0000'), /control/i);
  assert.throws(() => normalizeImportedText('   '), /Empty/);
});
