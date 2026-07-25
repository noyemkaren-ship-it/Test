import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Language = 'ru' | 'en'
export type ThemePreference = 'dark' | 'light' | 'system'
export type Accent = 'violet' | 'cyan' | 'sunset'
export type RelationDepth = 1 | 2

type PreferencesValue = {
  language: Language
  setLanguage: (value: Language) => void
  theme: ThemePreference
  setTheme: (value: ThemePreference) => void
  accent: Accent
  setAccent: (value: Accent) => void
  motion: boolean
  setMotion: (value: boolean) => void
  relationDepth: RelationDepth
  setRelationDepth: (value: RelationDepth) => void
  tr: (ru: string, en: string) => string
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const saved = localStorage.getItem(key) as T | null
  return saved && allowed.includes(saved) ? saved : fallback
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => readPreference('gp_language', ['ru', 'en'], 'ru'))
  const [theme, setTheme] = useState<ThemePreference>(() => readPreference('gp_theme', ['dark', 'light', 'system'], 'dark'))
  const [accent, setAccent] = useState<Accent>(() => readPreference('gp_accent', ['violet', 'cyan', 'sunset'], 'violet'))
  const [motion, setMotion] = useState(() => localStorage.getItem('gp_motion') !== 'false')
  const [relationDepth, setRelationDepth] = useState<RelationDepth>(() => localStorage.getItem('gp_relation_depth') === '2' ? 2 : 1)

  useEffect(() => {
    localStorage.setItem('gp_language', language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    localStorage.setItem('gp_theme', theme)
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system'
        ? (media.matches ? 'light' : 'dark')
        : theme
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('gp_accent', accent)
    document.documentElement.dataset.accent = accent
  }, [accent])

  useEffect(() => {
    localStorage.setItem('gp_motion', String(motion))
    document.documentElement.dataset.motion = motion ? 'on' : 'off'
  }, [motion])

  useEffect(() => {
    localStorage.setItem('gp_relation_depth', String(relationDepth))
  }, [relationDepth])

  const value = useMemo<PreferencesValue>(() => ({
    language,
    setLanguage,
    theme,
    setTheme,
    accent,
    setAccent,
    motion,
    setMotion,
    relationDepth,
    setRelationDepth,
    tr: (ru, en) => language === 'ru' ? ru : en
  }), [language, theme, accent, motion, relationDepth])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider')
  return value
}
