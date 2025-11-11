interface RollButtonProps {
  onClick: () => void
  disabled: boolean
}

/**
 * Button component for rolling the dice
 * Positioned at bottom center of screen
 * Disabled state while dice is rolling
 */
export function RollButton({ onClick, disabled }: RollButtonProps) {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-10">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label="Roll dice"
        className={`
          px-8 py-4 rounded-lg text-white font-bold text-lg
          transition-all duration-200 transform
          ${
            disabled
              ? 'bg-orange-500 opacity-50 cursor-not-allowed'
              : 'bg-orange-500 hover:bg-orange-600 active:scale-95 shadow-lg hover:shadow-xl'
          }
        `}
      >
        {disabled ? 'Rolling...' : 'Roll Dice'}
      </button>
    </div>
  )
}
