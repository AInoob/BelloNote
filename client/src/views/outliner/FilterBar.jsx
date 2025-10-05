import React from 'react'

/**
 * Filter bar component for the outliner view
 * @param {Object} props - Component props
 * @param {Array} props.availableFilters - Available filter options
 * @param {Object} props.statusFilter - Current status filter state
 * @param {Function} props.toggleStatusFilter - Function to toggle status filter
 * @param {Function} props.applyPresetFilter - Function to apply preset filter
 * @param {boolean} props.showArchived - Whether archived items are shown
 * @param {Function} props.setShowArchived - Function to set show archived state
 * @param {Object} props.showArchivedRef - Ref to show archived state
 * @param {Function} props.saveArchivedVisible - Function to save archived visible state
 * @param {Array} props.includeFilterList - List of include tag filters
 * @param {Function} props.removeTagFilter - Function to remove tag filter
 * @param {Object} props.includeInputRef - Ref to include input element
 * @param {string} props.includeTagInput - Include tag input value
 * @param {Function} props.handleTagInputChange - Function to handle tag input change
 * @param {Function} props.handleTagInputKeyDown - Function to handle tag input key down
 * @param {Function} props.handleTagInputBlur - Function to handle tag input blur
 * @param {Array} props.excludeFilterList - List of exclude tag filters
 * @param {Object} props.excludeInputRef - Ref to exclude input element
 * @param {string} props.excludeTagInput - Exclude tag input value
 * @param {Function} props.clearTagFilters - Function to clear all tag filters
 * @param {React.ReactNode} [props.extraControls] - Optional controls rendered at the end of the bar
 */
export function FilterBar({
  availableFilters,
  statusFilter,
  toggleStatusFilter,
  applyPresetFilter,
  showArchived,
  setShowArchived,
  showArchivedRef,
  saveArchivedVisible,
  includeFilterList,
  removeTagFilter,
  includeInputRef,
  includeTagInput,
  handleTagInputChange,
  handleTagInputKeyDown,
  handleTagInputBlur,
  excludeFilterList,
  excludeInputRef,
  excludeTagInput,
  clearTagFilters,
  extraControls
}) {
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
            try { saveArchivedVisible(next) } catch {}
            showArchivedRef.current = next
            setShowArchived(next)
          }}
        >{showArchived ? 'Shown' : 'Hidden'}</button>
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
        {(includeFilterList.length > 0 || excludeFilterList.length > 0) && (
          <button
            type="button"
            className="btn ghost"
            onClick={clearTagFilters}
            style={{ marginLeft: 8 }}
          >Clear</button>
        )}
      </div>
      {extraControls && (
        <div className="filter-extra-controls">
          {extraControls}
        </div>
      )}
    </div>
  )
}
