import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { apiUrl } from '../config'
import { usePreferences } from '../preferences'

type Props = {
  open: boolean
  headers: () => Record<string, string>
  onClose: () => void
  onImported: (result: any) => void
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

export default function KnowledgeImportDialog({ open, headers, onClose, onImported }: Props) {
  const { tr } = usePreferences()
  const inputRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [policy, setPolicy] = useState<any>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    fetch(apiUrl('/api/graphs/import-policy'), { headers: headers() })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        setPolicy(data)
      })
      .catch(e => setError(e instanceof Error ? e.message : tr('Импорт сейчас недоступен', 'Import is currently unavailable')))

    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, headers, onClose, tr])

  const preview = useMemo(() => {
    if (!raw.trim()) return null
    try {
      const parsed = JSON.parse(raw)
      const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : null
      const edges = Array.isArray(parsed.edges) ? parsed.edges.length : null
      if (nodes == null || edges == null) return { error: tr('Нужны массивы nodes и edges', 'nodes and edges arrays are required') }
      return {
        parsed,
        name: parsed.graph?.name || parsed.name || tr('Без названия', 'Untitled'),
        description: parsed.graph?.description || parsed.description || '',
        nodes,
        edges
      }
    } catch {
      return { error: tr('JSON содержит синтаксическую ошибку', 'JSON contains a syntax error') }
    }
  }, [raw, tr])

  async function readFile(file?: File) {
    setError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setError(tr('Выберите файл с расширением .json', 'Choose a .json file'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(tr('Файл больше 2 МБ', 'The file is larger than 2 MB'))
      return
    }
    try {
      setRaw(await file.text())
      setFileName(file.name)
    } catch {
      setError(tr('Не удалось прочитать файл', 'Unable to read the file'))
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    readFile(event.dataTransfer.files?.[0])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!preview || 'error' in preview) return setError(preview?.error || tr('Сначала выберите JSON', 'Choose a JSON file first'))
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl('/api/graphs/import'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ package: preview.parsed, sourceFileName: fileName })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      onImported(data)
      setRaw('')
      setFileName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Импорт не выполнен', 'Import failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="import-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <div className="import-dialog-head">
          <div><p className="eyebrow">Knowledge Package</p><h2 id="import-dialog-title">{tr('Загрузить новый граф из JSON', 'Upload a new graph from JSON')}</h2></div>
          <button type="button" className="chip" onClick={onClose} aria-label={tr('Закрыть', 'Close')}>×</button>
        </div>

        <form className="import-dialog-body" onSubmit={submit}>
          <div
            className={`member-file-drop ${dragging ? 'dragging' : ''}`}
            onDragEnter={event => { event.preventDefault(); setDragging(true) }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <span className="member-file-icon">⇧</span>
            <strong>{fileName || tr('Перетащите JSON сюда', 'Drop JSON here')}</strong>
            <small>{tr('или выберите файл до 2 МБ', 'or choose a file up to 2 MB')}</small>
            <button type="button" className="btn-primary compact" onClick={() => inputRef.current?.click()}>{tr('Выбрать JSON', 'Choose JSON')}</button>
            <input ref={inputRef} type="file" accept="application/json,.json" onChange={event => readFile(event.target.files?.[0])} hidden />
          </div>

          <div className="member-import-details">
            <div className="import-safety-note">
              <span>◆</span>
              <div><strong>{tr('Безопасный импорт в личный workspace', 'Safe import into your workspace')}</strong><small>{tr('Новый граф создаётся приватным. JSON проходит проверку структуры, размера и содержимого.', 'The new graph is private. JSON structure, size and content are validated.')}</small></div>
            </div>

            {preview && !('error' in preview) && (
              <div className="member-import-preview">
                <span>{tr('Предпросмотр', 'Preview')}</span>
                <strong>{preview.name}</strong>
                {preview.description && <small>{preview.description}</small>}
                <div><b>{preview.nodes}</b> {tr('узлов', 'nodes')}<i /> <b>{preview.edges}</b> {tr('связей', 'relations')}<i /> private</div>
              </div>
            )}
            {preview && 'error' in preview && <div className="console-notice error">{preview.error}</div>}

            <details className="import-paste-details">
              <summary>{tr('Вставить JSON вручную', 'Paste JSON manually')}</summary>
              <textarea className="json-editor" value={raw} onChange={event => { setRaw(event.target.value); setFileName('') }} rows={9} spellCheck={false} placeholder={'{\n  "graph": { "name": "Новый граф" },\n  "nodes": [],\n  "edges": []\n}'} />
            </details>

            {error && <div className="console-notice error" role="alert">{error}</div>}
            <div className="import-dialog-actions">
              <button type="submit" className="btn-primary" disabled={busy || !preview || 'error' in preview}>{busy ? tr('Проверяем и загружаем…', 'Validating and uploading…') : tr('Загрузить в мой workspace', 'Upload to my workspace')}</button>
              <button type="button" className="btn-quiet" onClick={onClose}>{tr('Отмена', 'Cancel')}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
