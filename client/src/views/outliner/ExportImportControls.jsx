import { useCallback, useRef, useState } from 'react'
import { fetchExportManifest, importManifestFile } from '../../api.js'

function buildDownloadFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `bellonote-export-${timestamp}.json`
}

export function ExportImportControls({ onImportComplete }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  const handleExport = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setStatus('Exporting…')
    try {
      const manifest = await fetchExportManifest()
      const serialized = JSON.stringify(manifest, null, 2)
      const blob = new Blob([serialized], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildDownloadFilename()
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      const noteCount = manifest?.entities?.notes?.length ?? 0
      setStatus(`Exported ${noteCount} item${noteCount === 1 ? '' : 's'}`)
    } catch (err) {
      setStatus(err?.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [busy])

  const handleImportChange = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setStatus('Importing…')
    try {
      const result = await importManifestFile(file)
      const imported = result?.notesImported ?? 0
      const summary = `Imported ${imported} item${imported === 1 ? '' : 's'}`
      setStatus(summary)
      onImportComplete?.()
    } catch (err) {
      const message = err?.message || 'Import failed'
      setStatus(message)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }, [onImportComplete])

  return (
    <div className="export-import-controls">
      <button
        type="button"
        className="btn"
        data-testid="export-outline"
        onClick={handleExport}
        disabled={busy}
      >Export</button>
      <button
        type="button"
        className="btn ghost"
        data-testid="import-outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >Import</button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        data-testid="import-manifest-input"
        style={{ display: 'none' }}
        onChange={handleImportChange}
      />
      {status && (
        <span className="export-import-status" data-testid="export-import-status">{status}</span>
      )}
    </div>
  )
}
