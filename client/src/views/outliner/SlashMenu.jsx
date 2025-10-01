import React from 'react'

/**
 * Slash menu component for the outliner view
 * @param {Object} props - Component props
 * @param {Object} props.menuRef - Ref to menu element
 * @param {Object} props.slashPos - Position of the slash menu
 * @param {string} props.slashQuery - Current slash query
 * @param {Function} props.setSlashQuery - Function to set slash query
 * @param {Function} props.updateSlashActive - Function to update active slash command
 * @param {Array} props.filteredCommands - Filtered slash commands
 * @param {number} props.slashActiveIndex - Index of active slash command
 * @param {Function} props.closeSlash - Function to close slash menu
 * @param {Object} props.slashInputRef - Ref to slash input element
 */
export function SlashMenu({
  menuRef,
  slashPos,
  slashQuery,
  setSlashQuery,
  updateSlashActive,
  filteredCommands,
  slashActiveIndex,
  closeSlash,
  slashInputRef
}) {
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

