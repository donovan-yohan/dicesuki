import { useState } from 'react'

interface HamburgerMenuProps {
  onAddDice?: (type: string) => void
  onRemoveDice?: (id: string) => void
  diceCount?: number
}

/**
 * Hamburger menu component for dice management
 * Provides UI for adding and removing different types of dice
 */
export function HamburgerMenu({ onAddDice, onRemoveDice, diceCount = 1 }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleMenu = () => setIsOpen(!isOpen)

  const handleAddDice = (type: string) => {
    onAddDice?.(type)
    setIsOpen(false)
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
          <div className="absolute top-0 left-0 w-64 h-full bg-gray-900 z-30 shadow-xl transition-transform">
            <div className="p-6">
              <h2 className="text-white text-xl font-bold mb-6">Dice Management</h2>

              {/* Current Dice Count */}
              <div className="mb-6 p-4 bg-gray-800 rounded-lg">
                <div className="text-gray-400 text-sm">Active Dice</div>
                <div className="text-white text-2xl font-bold">{diceCount}</div>
              </div>

              {/* Add Dice Section */}
              <div className="mb-4">
                <h3 className="text-gray-400 text-sm font-semibold mb-3">Add Dice</h3>
                <div className="space-y-2">
                  <MenuButton onClick={() => handleAddDice('d6')} label="D6 (Cube)" />
                  <MenuButton onClick={() => handleAddDice('d4')} label="D4 (Tetrahedron)" disabled />
                  <MenuButton onClick={() => handleAddDice('d8')} label="D8 (Octahedron)" disabled />
                  <MenuButton onClick={() => handleAddDice('d12')} label="D12 (Dodecahedron)" disabled />
                  <MenuButton onClick={() => handleAddDice('d20')} label="D20 (Icosahedron)" disabled />
                </div>
              </div>

              {/* Remove All Section */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <button
                  onClick={() => onRemoveDice?.('all')}
                  className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-semibold"
                  disabled={diceCount === 0}
                >
                  Remove All Dice
                </button>
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
