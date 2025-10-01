// ============================================================================
// Slash Menu Component
// Command palette for inserting special content via / command
// ============================================================================

import React from 'react'

export function SlashMenu({
  isOpen,
  menuRef,
  slashPos,
  slashQuery,
  setSlashQuery,
  slashActiveIndex,
  updateSlashActive,
  slashInputRef,
  filteredCommands,
  closeSlash
}) {
  if (!isOpen) return null

  return (
    <div
      ref={menuRef}
      className="slash-menu"
      style={{ left: slashPos.x, top: slashPos.y }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <input
        type="text"
        value={slashQuery}
        onChange={(e) => {
          updateSlashActive(0)
          setSlashQuery(e.target.value)
        }}
        placeholder="Type a command…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const command = filteredCommands[slashActiveIndex] || filteredCommands[0]
            command?.run()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            closeSlash()
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (filteredCommands.length) {
              const next = (slashActiveIndex + 1) % filteredCommands.length
              updateSlashActive(next)
            }
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (filteredCommands.length) {
              const next = (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length
              updateSlashActive(next)
            }
            return
          }
        }}
        ref={slashInputRef}
        autoFocus
      />
      {filteredCommands.length ? (
        filteredCommands.map((cmd, idx) => (
          <button
            key={cmd.id}
            type="button"
            onClick={cmd.run}
            className={idx === slashActiveIndex ? 'active' : ''}
          >
            <span className="cmd-label">{cmd.label}</span>
            {cmd.hint ? <span className="cmd-hint">{cmd.hint}</span> : null}
          </button>
        ))
      ) : (
        <div className="slash-empty">No matches</div>
      )}
      {!slashQuery && filteredCommands.length > 0 && (
        <div className="slash-hint">Type to filter commands · Enter to accept</div>
      )}
    </div>
  )
}
