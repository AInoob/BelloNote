import { apiClient } from '../client.js'

export async function fetchExportManifest() {
  try {
    const { data } = await apiClient.get('/export')
    return data
  } catch (err) {
    const message = err?.response?.data?.error || err?.message || 'Export failed'
    throw new Error(message)
  }
}

export async function importManifestFile(file) {
  const formData = new FormData()
  formData.append('manifest', file)
  try {
    const { data } = await apiClient.post('/import', formData)
    if (!data?.ok) {
      throw new Error(data?.error || 'Import failed')
    }
    return data
  } catch (err) {
    const message = err?.response?.data?.error || err?.message || 'Import failed'
    throw new Error(message)
  }
}
