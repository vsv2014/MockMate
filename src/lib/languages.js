// Single source of truth for interview languages + their speech-recognition codes.
// Was duplicated across LiveCompanion (LANGUAGES), Solo (inline array), and Solo (STT_LANG).
// Add a language in ONE place here.
export const LANGUAGES = [
  'English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam',
  'Spanish', 'French', 'German', 'Portuguese',
  'Japanese', 'Chinese', 'Korean', 'Arabic', 'Italian', 'Dutch'
]

// Coding languages offered in the screen-analysis + coding-mode pickers (was duplicated,
// with two different lists, in App.jsx and LiveCompanion.jsx).
export const CODING_LANGUAGES = ['Python', 'Java', 'C++', 'JavaScript', 'TypeScript', 'Go', 'C#', 'Ruby']

// Label → BCP-47 code for the browser speech engine (so it transcribes the right language).
export const STT_LANG = {
  English: 'en-US', Hindi: 'hi-IN', Telugu: 'te-IN', Tamil: 'ta-IN', Kannada: 'kn-IN', Malayalam: 'ml-IN',
  Spanish: 'es-ES', French: 'fr-FR', German: 'de-DE', Portuguese: 'pt-BR',
  Japanese: 'ja-JP', Chinese: 'zh-CN', Korean: 'ko-KR', Arabic: 'ar-SA', Italian: 'it-IT', Dutch: 'nl-NL'
}
