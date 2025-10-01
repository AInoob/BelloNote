// ============================================================================
// Image With Meta Extension
// TipTap extension that extends Image to preserve file metadata attributes
// ============================================================================

import Image from '@tiptap/extension-image'

/**
 * Creates an attribute definition that preserves HTML attributes
 * @param {string} name - Attribute name
 * @returns {Object} TipTap attribute definition
 */
const preserveAttr = (name) => ({
  default: null,
  parseHTML: (element) => element.getAttribute(name),
  renderHTML: (attributes) => {
    if (!attributes[name]) return {}
    return { [name]: attributes[name] }
  }
})

/**
 * ImageWithMeta TipTap Extension
 * Extends the base Image extension to preserve file metadata
 * Adds data-file-id and data-file-path attributes for tracking uploaded images
 */
export const ImageWithMeta = Image.extend({
  addAttributes() {
    const parent = this.parent ? this.parent() : {}
    return {
      ...parent,
      'data-file-id': preserveAttr('data-file-id'),
      'data-file-path': preserveAttr('data-file-path')
    }
  }
})
