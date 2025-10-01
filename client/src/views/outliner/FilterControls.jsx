import React from 'react'

export function FilterControls({
  isReadOnly,
  availableFilters,
  statusFilter,
  onToggleStatus,
  onApplyPreset,
  showArchived,
  onToggleArchived,
  showFuture,
  onToggleFuture,
  showSoon,
  onToggleSoon,
  includeFilterList,
  excludeFilterList,
  includeInputRef,
  excludeInputRef,
  includeTagInput,
  excludeTagInput,
  onIncludeChange,
  onIncludeKeyDown,
  onIncludeBlur,
  onExcludeChange,
  onExcludeKeyDown,
  onExcludeBlur,
  removeTagFilter,
  hasTagFilters,
  onClearTagFilters,
  searchQuery,
  onSearchChange,
  onSearchClear
}) {
  if (isReadOnly) return null

  return (
    <div className="status-filter-bar">
      <span className="meta" style={{ marginRight: 8 }}>Show:</span>
      {availableFilters.map((opt) => (
        <button
          key={opt.key}
          className={`btn pill ${statusFilter[opt.key] ? 'active' : ''}`}
          data-status={opt.key}
          type="button"
          onClick={() => onToggleStatus(opt.key)}
        >{opt.label}</button>
      ))}
      <div className="filter-presets">
        <button className="btn ghost" type="button" onClick={() => onApplyPreset('all')}>All</button>
        <button className="btn ghost" type="button" onClick={() => onApplyPreset('active')}>Active</button>
        <button className="btn ghost" type="button" onClick={() => onApplyPreset('completed')}>Completed</button>
      </div>
      <div className="archive-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Archived:</span>
        <button
          className={`btn pill ${showArchived ? 'active' : ''}`}
          type="button"
          onClick={onToggleArchived}
        >{showArchived ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="future-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Future:</span>
        <button
          className={`btn pill ${showFuture ? 'active' : ''}`}
          type="button"
          onClick={onToggleFuture}
        >{showFuture ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="soon-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="meta">Soon:</span>
        <button
          className={`btn pill ${showSoon ? 'active' : ''}`}
          type="button"
          onClick={onToggleSoon}
        >{showSoon ? 'Shown' : 'Hidden'}</button>
      </div>
      <div className="tag-filter-group">
        <div className="tag-filter include">
          <span className="meta">With:</span>
          {includeFilterList.map((tag) => (
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
            onChange={onIncludeChange}
            onKeyDown={onIncludeKeyDown}
            onBlur={onIncludeBlur}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="tag-filter exclude">
          <span className="meta">Without:</span>
          {excludeFilterList.map((tag) => (
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
            onChange={onExcludeChange}
            onKeyDown={onExcludeKeyDown}
            onBlur={onExcludeBlur}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {hasTagFilters && (
          <button type="button" className="btn ghost" onClick={onClearTagFilters}>Clear</button>
        )}
      </div>
      <div className="search-bar">
        <input
          type="search"
          value={searchQuery}
          placeholder="Search outline…"
          onChange={onSearchChange}
        />
        {searchQuery && (
          <button type="button" onClick={onSearchClear}>Clear</button>
        )}
      </div>
    </div>
  )
}
