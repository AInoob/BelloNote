// ============================================================================
// Filter Bar Component
// UI for status, tag, and visibility filters in the outline view
// ============================================================================

import React from 'react'

export function FilterBar({
  isReadOnly,
  availableFilters,
  statusFilter,
  toggleStatusFilter,
  applyPresetFilter,
  showArchived,
  setShowArchived,
  showFuture,
  setShowFuture,
  showSoon,
  setShowSoon,
  includeFilterList,
  excludeFilterList,
  removeTagFilter,
  includeTagInput,
  setIncludeTagInput,
  excludeTagInput,
  setExcludeTagInput,
  handleTagInputChange,
  handleTagInputKeyDown,
  handleTagInputBlur,
  hasTagFilters,
  clearTagFilters,
  searchQuery,
  setSearchQuery,
  includeInputRef,
  excludeInputRef,
  applyStatusFilterRef,
  editor
}) {
  if (isReadOnly) return null

  return (
    <div className="status-filter-bar">
      <span className="meta" style={{ marginRight: 8 }}>Show:</span>
      {availableFilters.map(opt => (
        <button
          key={opt.key}
          className={`btn pill ${statusFilter[opt.key] ? 'active' : ''}`}
          data-status={opt.key}
          type="button"
          onClick={() => toggleStatusFilter(opt.key)}
        >{opt.label}</button>
      ))}
      <div className="filter-presets">
        <button className="btn ghost" type="button" onClick={() => applyPresetFilter('all')}>All</button>
        <button className="btn ghost" type="button" onClick={() => applyPresetFilter('active')}>Active</button>
        <button className="btn ghost" type="button" onClick={() => applyPresetFilter('completed')}>Completed</button>
      </div>
      <div className="archive-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Archived:</span>
        <button
          className={`btn pill ${showArchived ? 'active' : ''}`}
          type="button"
          onClick={() => {
            const next = !showArchived
            setShowArchived(next)
          }}
        >{showArchived ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="future-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Future:</span>
        <button
          className={`btn pill ${showFuture ? 'active' : ''}`}
          type="button"
          onClick={() => {
            const next = !showFuture
            setShowFuture(next)
          }}
        >{showFuture ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="soon-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Soon:</span>
        <button
          className={`btn pill ${showSoon ? 'active' : ''}`}
          type="button"
          onClick={() => {
            const next = !showSoon
            setShowSoon(next)
            queueMicrotask(() => {
              try {
                if (next && editor?.view?.dom) {
                  const root = editor.view.dom
                  root.querySelectorAll('li.li-node[data-soon="1"]').forEach(li => {
                    li.classList.remove('filter-hidden')
                    li.style.display = ''
                  })
                }
                applyStatusFilterRef.current?.()
              } catch {}
            })
          }}
        >{showSoon ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="tag-filter-group">
        <div className="tag-filter include">
          <span className="meta">With:</span>
          {includeFilterList.map(tag => (
            <button
              key={`tag-include-${tag}`}
              type="button"
              className="tag-chip"
              onClick={() => removeTagFilter('include', tag)}
              aria-label={`Remove include filter #${tag}`}
            >
              #{tag}<span aria-hidden className="tag-chip-remove">×</span>
            </button>
          ))}
          <input
            ref={includeInputRef}
            className="tag-input"
            type="text"
            value={includeTagInput}
            placeholder="#tag"
            onChange={handleTagInputChange('include')}
            onKeyDown={handleTagInputKeyDown('include')}
            onBlur={handleTagInputBlur('include')}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="tag-filter exclude">
          <span className="meta">Without:</span>
          {excludeFilterList.map(tag => (
            <button
              key={`tag-exclude-${tag}`}
              type="button"
              className="tag-chip"
              onClick={() => removeTagFilter('exclude', tag)}
              aria-label={`Remove exclude filter #${tag}`}
            >
              #{tag}<span aria-hidden className="tag-chip-remove">×</span>
            </button>
          ))}
          <input
            ref={excludeInputRef}
            className="tag-input"
            type="text"
            value={excludeTagInput}
            placeholder="#tag"
            onChange={handleTagInputChange('exclude')}
            onKeyDown={handleTagInputKeyDown('exclude')}
            onBlur={handleTagInputBlur('exclude')}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {hasTagFilters && (
          <button type="button" className="btn ghost" onClick={clearTagFilters}>Clear</button>
        )}
      </div>
      <div className="search-bar">
        <input
          type="search"
          value={searchQuery}
          placeholder="Search outline…"
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')}>Clear</button>
        )}
      </div>
    </div>
  )
}
