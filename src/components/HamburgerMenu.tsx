import { useState } from 'react'

interface DiceInstance {
  id: string
  type: string
  color: string
}

interface HamburgerMenuProps {
  onAddDice?: (type: string) => void
  onRemoveDice?: (id: string) => void
  dice?: DiceInstance[]
}

/**
 * Hamburger menu component for dice management
 * Provides UI for adding and removing different types of dice
 */
export function HamburgerMenu({ onAddDice, onRemoveDice, dice = [] }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleMenu = () => setIsOpen(!isOpen)

  const handleAddDice = (type: string) => {
    console.log('HamburgerMenu: handleAddDice called with type:', type)
    console.log('HamburgerMenu: onAddDice prop:', onAddDice)
    onAddDice?.(type)
    setIsOpen(false)
  }

  const handleRemoveDice = (id: string) => {
    onRemoveDice?.(id)
  }

  return (
    <>
      {/* Hamburger Button */}
      <button
        onClick={toggleMenu}
        className="absolute top-4 left-4 z-30 w-12 h-12 flex flex-col items-center justify-center bg-black bg-opacity-75 rounded-lg hover:bg-opacity-90 transition-all"
        aria-label="Toggle menu"
      >
        <div className={`w-6 h-0.5 bg-white transition-all ${isOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
        <div className={`w-6 h-0.5 bg-white mt-1.5 transition-all ${isOpen ? 'opacity-0' : ''}`} />
        <div className={`w-6 h-0.5 bg-white mt-1.5 transition-all ${isOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
      </button>

      {/* Menu Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-20"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu Content */}
          <div className="absolute top-0 left-0 w-72 h-full bg-gray-900 z-30 shadow-xl transition-transform overflow-y-auto">
            <div className="p-6">
              <h2 className="text-white text-xl font-bold mb-6">Dice Management</h2>

              {/* Current Dice List */}
              <div className="mb-6">
                <h3 className="text-gray-400 text-sm font-semibold mb-3">
                  Active Dice ({dice.length})
                </h3>
                {dice.length === 0 ? (
                  <div className="p-4 bg-gray-800 rounded-lg text-gray-500 text-sm text-center">
                    No dice added yet
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {dice.map((die, index) => (
                      <div
                        key={die.id}
                        className="flex items-center justify-between p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {/* Color indicator */}
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: die.color }}
                          />
                          {/* Dice info */}
                          <div>
                            <div className="text-white font-medium">
                              {die.type.toUpperCase()}
                            </div>
                            <div className="text-gray-500 text-xs">
                              #{index + 1}
                            </div>
                          </div>
                        </div>
                        {/* Remove button */}
                        <button
                          onClick={() => handleRemoveDice(die.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-600 text-gray-400 hover:text-white transition-colors"
                          title="Remove dice"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Dice Section */}
              <div className="mb-4">
                <h3 className="text-gray-400 text-sm font-semibold mb-3">Add Dice</h3>
                <div className="space-y-2">
                  <MenuButton onClick={() => handleAddDice('d4')} label="D4 (Tetrahedron)" />
                  <MenuButton onClick={() => handleAddDice('d6')} label="D6 (Cube)" />
                  <MenuButton onClick={() => handleAddDice('d8')} label="D8 (Octahedron)" />
                  <MenuButton onClick={() => handleAddDice('d12')} label="D12 (Dodecahedron)" />
                  <MenuButton onClick={() => handleAddDice('d20')} label="D20 (Icosahedron)" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

interface MenuButtonProps {
  onClick: () => void
  label: string
  disabled?: boolean
}

function MenuButton({ onClick, label, disabled = false }: MenuButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-4 py-3 rounded-lg text-left transition-colors ${
        disabled
          ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
          : 'bg-gray-800 hover:bg-gray-700 text-white'
      }`}
    >
      {label}
    </button>
  )
}
