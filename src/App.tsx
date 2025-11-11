import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

type PermissionState = 'pending' | 'granted' | 'denied'

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

type SpeechRecognitionResultListLike = ArrayLike<SpeechRecognitionResultLike>

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike>

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionErrorEventLike = {
  error: string
}

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  const globalWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  return globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition ?? null
}

const DEFAULT_ACTIVATION_PHRASE = 'merhaba buğra'
const STORAGE_KEY = 'hello-bugra-assistant.activationPhrase'

const sanitizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const formatIdleHeadline = (phrase: string) =>
  `“${phrase || DEFAULT_ACTIVATION_PHRASE}” dediğinde beni uyandırırsın`

const toLower = (raw: string) => raw.toLowerCase()

const buildPhraseVariants = (phrase: string) => {
  const forms = new Set<string>()
  const trimmed = sanitizeWhitespace(phrase.toLowerCase())
  if (!trimmed) {
    return []
  }

  const withDiacritics = trimmed
  const withoutDiacritics = trimmed.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const noPunct = trimmed.replace(/[^\p{L}\s]/gu, ' ')
  const noPunctCollapsed = sanitizeWhitespace(noPunct)
  const asciiOnly = withoutDiacritics.replace(/[^a-z\s]/g, ' ')
  const asciiCollapsed = sanitizeWhitespace(asciiOnly)

  ;[
    withDiacritics,
    withoutDiacritics,
    noPunct,
    noPunctCollapsed,
    asciiOnly,
    asciiCollapsed,
  ]
    .map((value) => sanitizeWhitespace(value))
    .filter(Boolean)
    .forEach((value) => forms.add(value))

  return [...forms]
}

const App = () => {
  const [permission, setPermission] = useState<PermissionState>('pending')
  const [statusText, setStatusText] = useState('🎤 Dinleniyor...')
  const [headlineText, setHeadlineText] = useState(formatIdleHeadline(DEFAULT_ACTIVATION_PHRASE))
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastHeard, setLastHeard] = useState<string>('...')
  const [pendingPhrase, setPendingPhrase] = useState(DEFAULT_ACTIVATION_PHRASE)
  const [activePhrase, setActivePhrase] = useState(DEFAULT_ACTIVATION_PHRASE)
  const [phraseFeedback, setPhraseFeedback] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)
  const isTriggeringRef = useRef(false)
  const phraseVariantsRef = useRef<string[]>(buildPhraseVariants(DEFAULT_ACTIVATION_PHRASE))
  const activePhraseRef = useRef(DEFAULT_ACTIVATION_PHRASE)

  const playActivationSound = useCallback(() => {
    if (!('AudioContext' in window)) {
      return
    }

    const audioCtx =
      audioCtxRef.current ?? new AudioContext({ latencyHint: 'interactive' })
    audioCtxRef.current = audioCtx

    const now = audioCtx.currentTime
    const oscillator = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)

    gainNode.gain.setValueAtTime(0.001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.25, now + 0.015)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    oscillator.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.4)
  }, [])

  const resetToIdle = useCallback(() => {
    isTriggeringRef.current = false
    setIsActive(false)
    setStatusText('🎤 Dinleniyor...')
    setHeadlineText(formatIdleHeadline(activePhraseRef.current))
  }, [])

  const triggerActivation = useCallback(() => {
    if (isTriggeringRef.current) {
      return
    }

    isTriggeringRef.current = true
    setIsActive(true)
    setStatusText('🟢 Asistan aktif')
    setHeadlineText('✅ Asistan aktif!')
    playActivationSound()

    if (resetTimeoutRef.current) {
      window.clearTimeout(resetTimeoutRef.current)
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      resetToIdle()
    }, 3000)
  }, [playActivationSound, resetToIdle])

  useEffect(() => {
    const SpeechRecognitionConstructor = getSpeechRecognition()

    if (!SpeechRecognitionConstructor) {
      setError('Tarayıcınız Web Speech API\'yi desteklemiyor.')
      return
    }

    let mounted = true
    let restartHandle: number | null = null

    const requestMicrophonePermission = async (): Promise<boolean> => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
        if (mounted) {
          setPermission('granted')
        }
        return true
      } catch (err) {
        console.error(err)
        if (mounted) {
          setPermission('denied')
          setError('Sesli komutlar için mikrofon erişimi gerekiyor.')
        }
        return false
      }
    }

    const setupRecognition = () => {
      if (!mounted) return

      const recognition = new SpeechRecognitionConstructor()
      recognitionRef.current = recognition

      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'tr-TR'

      recognition.onresult = (event) => {
        const transcripts: string[] = []

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const { transcript } = event.results[i][0]
          transcripts.push(transcript)
        }

        const combined = transcripts.join(' ').trim()
        setLastHeard(combined.length > 0 ? combined : '...')

        const lower = toLower(combined)
        const diacriticFree = lower.normalize('NFD').replace(/\p{Diacritic}/gu, '')
        const lowerSansPunct = lower.replace(/[^\p{L}\s]/gu, ' ')
        const asciiSansPunct = diacriticFree.replace(/[^a-z\s]/g, ' ')

        const candidates = [
          lower,
          lowerSansPunct,
          sanitizeWhitespace(lowerSansPunct),
          diacriticFree,
          asciiSansPunct,
          sanitizeWhitespace(asciiSansPunct),
        ].filter(Boolean)

        const shouldActivate = phraseVariantsRef.current.some((phraseVariant) =>
          candidates.some((candidate) => candidate.includes(phraseVariant)),
        )

        if (shouldActivate) {
          triggerActivation()
        }
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error)

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setPermission('denied')
          setError('Mikrofon izni engellenmiş. Lütfen tarayıcı ayarlarından izin verip sayfayı yenileyin.')
        } else if (event.error === 'no-speech') {
          // benign; ignore
        } else {
          setError('Ses tanıma sırasında bir hata oluştu. Yeniden deniyorum…')
        }
      }

      recognition.onend = () => {
        if (!mounted) return
        restartHandle = window.setTimeout(() => {
          try {
            recognition.start()
          } catch (err) {
            console.error('Failed to restart recognition', err)
          }
        }, 300)
      }

      const startRecognition = () => {
        try {
          recognition.start()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          if (!errorMessage.includes('already started')) {
            console.error('Failed to start recognition', errorMessage)
          }
        }
      }

      startRecognition()
    }

    requestMicrophonePermission().then((granted) => {
      if (!mounted || !granted) {
        return
      }
      setupRecognition()
    })

    return () => {
      mounted = false

      if (restartHandle) {
        window.clearTimeout(restartHandle)
      }

      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current)
      }

      const recognition = recognitionRef.current
      if (recognition) {
        recognition.onend = null
        recognition.onerror = null
        recognition.onresult = null
        try {
          recognition.stop()
        } catch (err) {
          console.error('Failed to stop recognition', err)
        }
      }

      if (audioCtxRef.current?.state !== 'closed') {
        audioCtxRef.current?.close().catch((err) => {
          console.error('Failed to close audio context', err)
        })
      }
    }
  }, [triggerActivation])

  useEffect(
    () => () => {
      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setPendingPhrase(stored)
        setActivePhrase(stored)
        phraseVariantsRef.current = buildPhraseVariants(stored)
        activePhraseRef.current = stored
        setHeadlineText(formatIdleHeadline(stored))
      }
    } catch (err) {
      console.error('Failed to load stored activation phrase', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const variants = buildPhraseVariants(activePhrase)
    phraseVariantsRef.current =
      variants.length > 0 ? variants : buildPhraseVariants(DEFAULT_ACTIVATION_PHRASE)
    activePhraseRef.current = sanitizeWhitespace(activePhrase) || DEFAULT_ACTIVATION_PHRASE

    try {
      const toPersist =
        sanitizeWhitespace(activePhrase) || DEFAULT_ACTIVATION_PHRASE
      localStorage.setItem(STORAGE_KEY, toPersist)
    } catch (err) {
      console.error('Failed to persist activation phrase', err)
    }
  }, [activePhrase])

  useEffect(() => {
    if (!phraseFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => setPhraseFeedback(null), 2000)
    return () => window.clearTimeout(timeoutId)
  }, [phraseFeedback])

  const handlePhraseSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const sanitized = sanitizeWhitespace(pendingPhrase)
      const nextPhrase = sanitized || DEFAULT_ACTIVATION_PHRASE
      setActivePhrase(nextPhrase)
      setPhraseFeedback(
        sanitized ? 'Aktivasyon ifadesi güncellendi.' : 'Varsayılan ifadeye dönüldü.',
      )
    },
    [pendingPhrase],
  )

  const handlePhraseChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPendingPhrase(event.target.value)
    },
    [],
  )

  useEffect(() => {
    if (!isActive) {
      setHeadlineText(formatIdleHeadline(activePhraseRef.current))
    }
  }, [activePhrase, isActive])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-slate-100">
      <div className="relative flex w-full max-w-3xl flex-col items-center gap-8 rounded-3xl border border-white/5 bg-slate-950/60 p-12 text-center shadow-[0_0_70px_rgba(15,23,42,0.75)] backdrop-blur">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-cyan-500/20 via-transparent to-slate-900/60 blur-3xl" />
        <div className="relative flex flex-col items-center gap-6">
          <div className="relative flex items-center justify-center">
            <div
              className={`flex h-48 w-48 items-center justify-center rounded-full border border-cyan-300/30 transition duration-500 ${
                isActive ? 'bg-emerald-500/20 shadow-glowStrong' : 'bg-slate-900/70 shadow-glow'
              } ${isActive ? 'animate-pulse' : 'animate-listeningPulse'}`}
            >
              <div
                className={`h-20 w-20 rounded-full bg-gradient-to-br from-cyan-400 via-sky-400 to-emerald-400 transition ${
                  isActive ? 'shadow-[0_0_35px_rgba(16,185,129,0.85)]' : 'shadow-[0_0_20px_rgba(34,211,238,0.55)]'
                }`}
              />
            </div>
            {isActive && (
              <span className="pointer-events-none absolute inline-flex h-48 w-48 animate-pulseRing rounded-full border border-emerald-400/40" />
            )}
          </div>

          <div className="space-y-2">
            <p className="text-2xl font-semibold tracking-tight text-slate-50 transition">
              {headlineText}
            </p>
            <p className="text-base text-slate-400">
              Asistan sürekli dinlemede ve aktivasyon ifadesini duyduğunda uyanıyor.
            </p>
          </div>

          <div className="rounded-full bg-slate-900/60 px-6 py-2 text-sm font-medium text-cyan-200 shadow-inner shadow-cyan-500/20">
            {statusText}
          </div>

          <div className="rounded-2xl border border-white/5 bg-slate-900/50 px-4 py-3 text-xs font-medium text-slate-300 shadow-inner">
            <p className="uppercase tracking-[0.2em] text-cyan-200/80">Son duyulan</p>
            <p className="mt-1 max-w-xs break-words text-sm text-slate-200/90">{lastHeard}</p>
          </div>

          {permission === 'pending' && !error && (
            <p className="text-sm text-slate-400">Mikrofon izni isteniyor…</p>
          )}

          {permission === 'denied' && (
            <p className="text-sm text-rose-300">
              Lütfen tarayıcı ayarlarından mikrofon erişimine izin verip sayfayı yenileyin.
            </p>
          )}

          {error && permission !== 'denied' && (
            <p className="text-sm text-amber-300">{error}</p>
          )}
        </div>
        <div className="w-full rounded-3xl border border-white/5 bg-slate-950/60 p-6 text-left shadow-inner shadow-sky-900/30">
          <h2 className="text-lg font-semibold text-slate-100">Aktivasyon ayarları</h2>
          <p className="mt-1 text-sm text-slate-400">
            Asistanı uyandıracak ifadeyi seç. Aksan ve noktalama işaretleri otomatik olarak eşleştirilir.
          </p>
          <form
            className="mt-4 flex flex-col gap-3 md:flex-row md:items-end"
            onSubmit={handlePhraseSubmit}
          >
            <label className="flex-1 text-sm font-medium text-slate-200">
              Aktivasyon ifadesi
              <input
                value={pendingPhrase}
                onChange={handlePhraseChange}
                placeholder="merhaba buğra"
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-base text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/40"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-cyan-500/30 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 md:h-[42px]"
            >
              Kaydet
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="rounded-full bg-slate-900/70 px-3 py-1 text-cyan-200/90">
              Aktif: <strong className="text-slate-100">{activePhrase}</strong>
            </span>
            {phraseFeedback && (
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">
                {phraseFeedback}
              </span>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export default App

