import Image from '@tiptap/extension-image'

const preserveAttr = (name) => ({
  default: null,
  parseHTML: (element) => element.getAttribute(name),
  renderHTML: (attributes) => {
    if (!attributes[name]) return {}
    return { [name]: attributes[name] }
  }
})

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
