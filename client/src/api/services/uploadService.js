/**
 * API service for file upload operations
 */
import { apiClient, absoluteUrl } from '../client.js'
import { API_ROOT } from '../../constants/config.js'

/**
 * Upload an image file
 * @param {File} file - The file to upload
 * @param {string} [filename] - Optional filename override
 * @returns {Promise<Object>} Upload result with URLs and metadata
 */
export async function uploadImage(file, filename) {
  const form = new FormData()
  const name = filename || (file && typeof file.name === 'string' ? file.name : null)
  
  if (name) {
    form.append('image', file, name)
  } else {
    form.append('image', file)
  }
  
  const { data } = await apiClient.post('/upload/image', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  
  const relRaw = typeof data.url === 'string' ? data.url : ''
  const relativeUrl = relRaw.startsWith('/') ? relRaw : (relRaw ? `/${relRaw}` : '')
  const isAbsoluteUrl = /^https?:\/\//i.test(relativeUrl)
  const absoluteUrlValue = isAbsoluteUrl ? relativeUrl : `${API_ROOT}${relativeUrl}`
  
  return {
    url: absoluteUrlValue,
    relativeUrl: relativeUrl || absoluteUrlValue,
    id: data.id,
    mimeType: data.mimeType,
    size: data.size
  }
}

