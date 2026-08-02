import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDiceStore, type RollSnapshot } from './useDiceStore'

/**
 * Drain a roll cycle through the ONE path that still snapshots it: a saved roll
 * with follow-up waves, where `roll_complete` is deliberately suppressed and
 * `finishSavedRollWaves` writes the row instead.
 *
 * An ordinary roll's row is written by the `roll_complete` handler (issue
 * #211) and is covered in `useMultiplayerStore.test.ts`; closing a plain cycle
 * records nothing at all.
 */
function asWaveRoll(body: () => void, player?: RollSnapshot['player']) {
  useDiceStore.getState().beginSavedRollWaves()
  body()
  useDiceStore.getState().finishSavedRollWaves(player)
}

describe('useDiceStore', () => {
  beforeEach(() => {
    useDiceStore.getState().reset()
  })

  // An 'initial state' block used to assert these five defaults with nothing
  // between `beforeEach`'s `reset()` and the assertion. The `reset` suite at the
  // bottom of this file asserts the same five fields *after* real mutation,
  // which is the only version that can catch a broken `reset()`.

  describe('markDiceRolling', () => {
    it('should add dice IDs to rollingDice set', () => {
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      const { rollingDice } = useDiceStore.getState()
      expect(rollingDice.has('die-1')).toBe(true)
      expect(rollingDice.has('die-2')).toBe(true)
      expect(rollingDice.size).toBe(2)
    })

    it('should remove dice from settledDice when marked as rolling', () => {
      // Settle a die first
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)

      // Mark as rolling again
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(false)
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)
    })

    it('should start a new cycle when rollingDice was empty', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      const { currentRollCycleDice } = useDiceStore.getState()
      expect(currentRollCycleDice.has('die-1')).toBe(true)
      expect(currentRollCycleDice.size).toBe(1)
    })

    it('should accumulate to existing cycle when rollingDice was non-empty', () => {
      // Start rolling one die (new cycle)
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(1)

      // Another die starts rolling (same cycle)
      useDiceStore.getState().markDiceRolling(['die-2'])
      const { currentRollCycleDice } = useDiceStore.getState()
      expect(currentRollCycleDice.has('die-1')).toBe(true)
      expect(currentRollCycleDice.has('die-2')).toBe(true)
      expect(currentRollCycleDice.size).toBe(2)
    })

    it('should start a fresh cycle after previous cycle completed', () => {
      // Complete a full cycle
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      // die-1 settled, so the cycle CLOSED — and recorded nothing (issue #211).
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)

      // Start a new cycle
      useDiceStore.getState().markDiceRolling(['die-2'])
      const { currentRollCycleDice } = useDiceStore.getState()
      // New cycle should only have die-2
      expect(currentRollCycleDice.has('die-2')).toBe(true)
      expect(currentRollCycleDice.has('die-1')).toBe(false)
    })

    describe('someone else\'s roll (issue #221)', () => {
      it('marks their dice rolling without joining them to our cycle', () => {
        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })

        const { rollingDice, currentRollCycleDice } = useDiceStore.getState()
        expect(rollingDice.has('theirs')).toBe(true)
        expect(currentRollCycleDice.size).toBe(0)
      })

      it('drops their stale settled faces, so the HUD stops showing them', () => {
        // Their dice are not in our cycle, but they ARE on the table: leaving
        // the last roll's faces in `settledDice` would keep them in the total
        // while the dice tumble.
        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })
        useDiceStore.getState().recordDieSettled('theirs', 5, 'd6')
        expect(useDiceStore.getState().settledDice.has('theirs')).toBe(true)

        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })
        expect(useDiceStore.getState().settledDice.has('theirs')).toBe(false)
      })

      it('does not reset OUR cycle, its claim or its orphan mark', () => {
        // The #221 repro at store level: their roll landing between our waves
        // used to look like a brand-new cycle, wiping the dice our wave row is
        // built from along with the ticket that stops it being written twice.
        useDiceStore.getState().beginSavedRollWaves(['mine-1'])
        useDiceStore.getState().markDiceRolling(['mine-1'])
        useDiceStore.getState().recordDieSettled('mine-1', 3, 'd6')

        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })

        expect([...useDiceStore.getState().currentRollCycleDice]).toEqual(['mine-1'])
        expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['mine-1'])
      })

      it('does not make our NEXT roll join the last one', () => {
        // `wasEmpty` used to be asked of the whole table, so a rival's die in
        // the air meant our fresh roll extended the closed cycle instead.
        useDiceStore.getState().markDiceRolling(['die-1'])
        useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })

        useDiceStore.getState().markDiceRolling(['die-2'])

        expect([...useDiceStore.getState().currentRollCycleDice]).toEqual(['die-2'])
      })

      it('does not hold our cycle open once our own dice have landed', () => {
        // The close is asked of the cycle's dice, not the table's. Held open by
        // a rival's die, the finished cycle stayed available to be orphaned by
        // the next bit of tidying up.
        useDiceStore.getState().markDiceRolling(['mine-1'])
        useDiceStore.getState().markDiceRolling(['theirs'], { ownRoll: false })

        useDiceStore.getState().recordDieSettled('mine-1', 6, 'd6')

        expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
        expect(useDiceStore.getState().rollingDice.has('theirs')).toBe(true)
      })
    })
  })

  describe('recordDieSettled', () => {
    it('should add die to settledDice map', () => {
      useDiceStore.getState().recordDieSettled('die-1', 5, 'd6')
      const { settledDice } = useDiceStore.getState()
      expect(settledDice.has('die-1')).toBe(true)
      expect(settledDice.get('die-1')?.value).toBe(5)
      expect(settledDice.get('die-1')?.type).toBe('d6')
    })

    it('should remove die from rollingDice when it settles', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)

      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(false)
    })

    it('should update value if die was already settled', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-1', 5, 'd6')
      expect(useDiceStore.getState().settledDice.get('die-1')?.value).toBe(5)
    })

    it('closes the cycle WITHOUT recording history when the last die settles', () => {
      // Issue #211: this drain used to push its own snapshot on top of the
      // `roll_complete` row, so one roll appeared twice ("Roll #1 / 10" beside
      // "You / 10"). Draining now only closes the cycle.
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])

      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(2)

      useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)

      // The faces are still on the table for the HUD and for `roll_complete`.
      expect(useDiceStore.getState().settledDice.get('die-1')?.value).toBe(4)
      expect(useDiceStore.getState().settledDice.get('die-2')?.value).toBe(6)
    })

    it('does not resurrect a closed cycle when a settled die re-settles', () => {
      // `dice_knocked` never calls `markDiceRolling`, so a knocked die's
      // re-settle lands on an empty cycle and cannot reopen a finished roll.
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)

      useDiceStore.getState().recordDieSettled('die-1', 2, 'd6')

      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
      expect(useDiceStore.getState().settledDice.get('die-1')?.value).toBe(2)
    })

    it('should only include currentRollCycleDice in the wave snapshot', () => {
      // Settle die-3 without it being part of a cycle (e.g. already on table)
      useDiceStore.getState().recordDieSettled('die-3', 2, 'd6')

      asWaveRoll(() => {
        // Start a roll cycle with die-1 and die-2
        useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
        useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
        useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')
      })

      const snapshot = useDiceStore.getState().rollHistory[0]
      // Only die-1 and die-2 should be in snapshot, not die-3
      expect(snapshot.dice.length).toBe(2)
      expect(snapshot.dice.map(d => d.diceId).sort()).toEqual(['die-1', 'die-2'])
      expect(snapshot.sum).toBe(10)
    })

    it('should handle knock-on effect: die knocked into another during cycle', () => {
      asWaveRoll(() => {
        // Die-1 starts rolling (new cycle)
        useDiceStore.getState().markDiceRolling(['die-1'])

        // Die-1 knocks die-2 into motion (same cycle)
        useDiceStore.getState().markDiceRolling(['die-2'])

        // Both settle
        useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
        useDiceStore.getState().recordDieSettled('die-2', 5, 'd6')
      })

      const snapshot = useDiceStore.getState().rollHistory[0]
      expect(snapshot.dice.length).toBe(2)
      expect(snapshot.sum).toBe(8)
    })
  })

  describe('tapping individual die', () => {
    it('should only track tapped die in cycle when others are settled', () => {
      // All dice settled on table
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 4, 'd6')
      useDiceStore.getState().recordDieSettled('die-3', 5, 'd6')

      useDiceStore.getState().beginSavedRollWaves()
      // Tap/drag only die-2
      useDiceStore.getState().markDiceRolling(['die-2'])

      // Only die-2 in cycle
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(1)
      expect(useDiceStore.getState().currentRollCycleDice.has('die-2')).toBe(true)

      // die-1 and die-3 still settled
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)
      expect(useDiceStore.getState().settledDice.has('die-3')).toBe(true)

      // die-2 removed from settled
      expect(useDiceStore.getState().settledDice.has('die-2')).toBe(false)

      // When die-2 settles, the recorded row should only log die-2
      useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')
      useDiceStore.getState().finishSavedRollWaves()

      const snapshot = useDiceStore.getState().rollHistory[0]
      expect(snapshot.dice.length).toBe(1)
      expect(snapshot.dice[0].diceId).toBe('die-2')
      expect(snapshot.sum).toBe(6)
    })
  })

  describe('removeDieState', () => {
    it('should remove die from settledDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(false)
    })

    it('should remove die from rollingDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(false)
    })

    it('should remove die from currentRollCycleDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().currentRollCycleDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().currentRollCycleDice.has('die-1')).toBe(false)
    })
  })

  describe('clearAllDieStates', () => {
    it('should empty settledDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 4, 'd6')

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().settledDice.size).toBe(0)
    })

    it('should empty rollingDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().rollingDice.size).toBe(0)
    })

    it('should empty currentRollCycleDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
    })

    it('should not clear rollHistory', () => {
      // Create a history entry the way a finished roll does
      useDiceStore.getState().addRollToHistory({ dice: [], sum: 4, timestamp: Date.now() })
      expect(useDiceStore.getState().rollHistory.length).toBe(1)

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().rollHistory.length).toBe(1)
    })
  })

  describe('clearHistory', () => {
    it('should clear rollHistory', () => {
      useDiceStore.getState().addRollToHistory({ dice: [], sum: 4, timestamp: Date.now() })
      expect(useDiceStore.getState().rollHistory.length).toBe(1)

      useDiceStore.getState().clearHistory()
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should not affect settledDice or rollingDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().markDiceRolling(['die-2'])

      useDiceStore.getState().clearHistory()
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)
      expect(useDiceStore.getState().rollingDice.has('die-2')).toBe(true)
    })
  })

  describe('activeSavedRoll', () => {
    it('should store active roll data via setActiveSavedRoll', () => {
      const perDieBonuses = new Map([['die-1', 2], ['die-2', 2]])
      useDiceStore.getState().setActiveSavedRoll({
        name: 'Fireball',
        flatBonus: 4,
        perDieBonuses,
      })

      const { activeSavedRoll } = useDiceStore.getState()
      expect(activeSavedRoll).not.toBeNull()
      expect(activeSavedRoll!.name).toBe('Fireball')
      expect(activeSavedRoll!.flatBonus).toBe(4)
      expect(activeSavedRoll!.perDieBonuses.get('die-1')).toBe(2)
      expect(activeSavedRoll!.perDieBonuses.get('die-2')).toBe(2)
      expect(activeSavedRoll!.perDieBonuses.size).toBe(2)
    })

    it('should clear active roll via clearActiveSavedRoll', () => {
      useDiceStore.getState().setActiveSavedRoll({
        name: 'Fireball',
        flatBonus: 4,
        perDieBonuses: new Map(),
      })
      expect(useDiceStore.getState().activeSavedRoll).not.toBeNull()

      useDiceStore.getState().clearActiveSavedRoll()
      expect(useDiceStore.getState().activeSavedRoll).toBeNull()
    })

    it('should handle empty perDieBonuses map', () => {
      useDiceStore.getState().setActiveSavedRoll({
        name: 'Simple Roll',
        flatBonus: 0,
        perDieBonuses: new Map(),
      })

      const { activeSavedRoll } = useDiceStore.getState()
      expect(activeSavedRoll!.perDieBonuses.size).toBe(0)
      expect(activeSavedRoll!.flatBonus).toBe(0)
    })
  })

  describe('percentile (d100) wave snapshots', () => {
    // Pairing travels on each die's presentation block, NOT in roll state, so
    // these snapshots stay correct no matter what happened to the saved roll.
    // These drive the wave path — the only one that still snapshots a cycle.
    // The same correction on the `roll_complete` path (every ordinary roll,
    // local or remote) is covered in `useMultiplayerStore.test.ts`.
    const TENS = { percentilePairId: 'p1', percentileRole: 'tens' as const }
    const ONES = { percentilePairId: 'p1', percentileRole: 'ones' as const }

    it('sums a normal pair as tens + ones', () => {
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['tens', 'ones'])
        useDiceStore.getState().recordDieSettled('tens', 30, 'd10tens', TENS)
        useDiceStore.getState().recordDieSettled('ones', 4, 'd10', ONES)
      })

      const [snapshot] = useDiceStore.getState().rollHistory
      expect(snapshot.sum).toBe(34)
    })

    it('records 00 + 0 as 100, not 0 (the server total stays a plain sum)', () => {
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['tens', 'ones'])
        useDiceStore.getState().recordDieSettled('tens', 0, 'd10tens', TENS)
        useDiceStore.getState().recordDieSettled('ones', 0, 'd10', ONES)
      })

      const [snapshot] = useDiceStore.getState().rollHistory
      // Raw faces are still both 0 — only the aggregate is corrected.
      expect(snapshot.dice.map((die) => die.value)).toEqual([0, 0])
      expect(snapshot.sum).toBe(100)
    })

    it('stays correct with NO active saved roll (refresh / remote-view path)', () => {
      // The regression this guards: pairing used to live in `activeSavedRoll`, so
      // any client without it — a reconnected client, a remote viewer — saw 0.
      expect(useDiceStore.getState().activeSavedRoll).toBeNull()
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['tens', 'ones'])
        useDiceStore.getState().recordDieSettled('tens', 0, 'd10tens', TENS)
        useDiceStore.getState().recordDieSettled('ones', 0, 'd10', ONES)
      })

      expect(useDiceStore.getState().rollHistory[0].sum).toBe(100)
    })

    it('survives a table edit that clears the active saved roll', () => {
      useDiceStore.getState().setActiveSavedRoll({
        name: 'Percentile',
        flatBonus: 0,
        perDieBonuses: new Map(),
      })
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['tens', 'ones', 'added-d6'])
        useDiceStore.getState().recordDieSettled('tens', 0, 'd10tens', TENS)
        // Adding a die to the table clears the active saved roll (backend behavior).
        useDiceStore.getState().clearActiveSavedRoll()
        useDiceStore.getState().recordDieSettled('ones', 0, 'd10', ONES)
        useDiceStore.getState().recordDieSettled('added-d6', 5, 'd6')
      })

      expect(useDiceStore.getState().rollHistory[0].sum).toBe(105)
    })

    it('adds a percentile pair alongside ordinary dice', () => {
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['tens', 'ones', 'plain'])
        useDiceStore.getState().recordDieSettled('tens', 0, 'd10tens', TENS)
        useDiceStore.getState().recordDieSettled('ones', 0, 'd10', ONES)
        useDiceStore.getState().recordDieSettled('plain', 5, 'd6')
      })

      expect(useDiceStore.getState().rollHistory[0].sum).toBe(105)
    })

    it('does not pair two loose d10s that were never spawned as a d100', () => {
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
        useDiceStore.getState().recordDieSettled('die-1', 0, 'd10')
        useDiceStore.getState().recordDieSettled('die-2', 0, 'd10')
      })

      expect(useDiceStore.getState().rollHistory[0].sum).toBe(0)
    })
  })

  describe('wave sequence that gives up before the table is still', () => {
    it('records what HAS settled rather than losing the roll', () => {
      // A wave failure or a timed-out wait ends the sequence with dice still in
      // the air. This used to bail out recording nothing while the roll's
      // `roll_complete` stayed claimed — the roll vanished from history.
      useDiceStore.getState().beginSavedRollWaves(['die-1', 'die-2'])
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')

      useDiceStore.getState().finishSavedRollWaves()

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['die-1'])
      expect(history[0].sum).toBe(4)
      // The latch must always be released — holding it locks out every later roll.
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
    })

    it('hands the roll back to roll_complete when nothing settled at all', () => {
      useDiceStore.getState().beginSavedRollWaves(['die-1'])
      useDiceStore.getState().markDiceRolling(['die-1'])

      useDiceStore.getState().finishSavedRollWaves()

      // No row to write, so the claim is released and the room's own
      // `roll_complete` records the roll instead of being swallowed.
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
      expect(useDiceStore.getState().suppressedRollDiceIds).toBeNull()
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
    })
  })

  describe('suppression ticket', () => {
    it('survives the wave latch clearing, so a late roll_complete is still claimed', () => {
      // Waves that never trigger close in the same task the dice settle in —
      // before `roll_complete` crosses the socket. The claim has to outlive the
      // latch or that message writes a duplicate row.
      useDiceStore.getState().beginSavedRollWaves(['die-1'])
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().finishSavedRollWaves()

      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['die-1'])
    })

    it('is dropped when a new cycle opens, so an unchanged table can re-roll', () => {
      useDiceStore.getState().beginSavedRollWaves(['die-1'])
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().finishSavedRollWaves()
      expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['die-1'])

      // Rolling the same table again presents the SAME dice ids; an unclaimed
      // stale ticket would swallow this roll's row.
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().suppressedRollDiceIds).toBeNull()
    })

    it('records the claim in spawn order, for the handler to match set-wise', () => {
      // The room sorts its results by dice id, so a positional comparison would
      // miss whenever spawn order differs from sorted order.
      useDiceStore.getState().beginSavedRollWaves(['b', 'a'])
      expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['b', 'a'])
    })
  })

  describe('a removal that shrinks the roll in flight', () => {
    const PLAYER = { id: 'p1', displayName: 'Me', color: '#f00' }

    /** One whole `dice_removed` message, the way the handler applies it. */
    function removeDice(ids: string[], player?: typeof PLAYER) {
      useDiceStore.getState().applyDiceRemoval(ids, player)
    }

    it('records the roll once the SURVIVORS settle, not at removal time', () => {
      // The room drops `pending_roll` when a die it tracked is removed, so the
      // roll is never announced and would otherwise leave no trace. The row is
      // written by the ordinary drain, so dice still in the air when the removal
      // lands are counted — recording at removal time would drop them.
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2', 'die-3'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')

      removeDice(['die-3'], PLAYER)
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)

      // die-2 was still tumbling when the die was trashed.
      useDiceStore.getState().recordDieSettled('die-2', 5, 'd6')

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId).sort()).toEqual(['die-1', 'die-2'])
      expect(history[0].sum).toBe(9)
      expect(history[0].player?.displayName).toBe('Me')
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
      expect(useDiceStore.getState().orphanedCycle).toBeNull()
    })

    it('records the roll when the removal beats every die to the table', () => {
      // Nothing had settled yet — the natural timing, since a removal races the
      // physics. A point-in-time snapshot found an empty cycle and recorded
      // nothing at all.
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])

      removeDice(['die-2'], PLAYER)
      useDiceStore.getState().recordDieSettled('die-1', 6, 'd6')

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['die-1'])
      expect(history[0].sum).toBe(6)
    })

    /**
     * Sweep away a whole 2-die roll, one die settled and one still in the air,
     * in the given id order. This is the shape that diverged: applied per die,
     * removing the SETTLED one last emptied the cycle a moment before the close
     * was evaluated and the row was dropped, while the reverse order recorded
     * it — and which order a `dice_removed` batch arrives in is a coin flip.
     */
    function sweepBothDice(ids: string[]) {
      useDiceStore.getState().reset()
      useDiceStore.getState().markDiceRolling(['settled', 'airborne'])
      useDiceStore.getState().recordDieSettled('settled', 4, 'd6')
      removeDice(ids, PLAYER)
      return useDiceStore.getState()
    }

    it('records nothing when the message sweeps the whole roll away, either order', () => {
      // The chosen semantics, matching what Clear All always did: a roll the
      // player deliberately swept off the table is not a roll to report. What
      // matters most is that BOTH orders agree.
      const settledLast = sweepBothDice(['airborne', 'settled'])
      const settledFirst = sweepBothDice(['settled', 'airborne'])

      expect(settledLast.rollHistory).toHaveLength(0)
      expect(settledFirst.rollHistory).toHaveLength(0)
      expect(settledLast.orphanedCycle).toBeNull()
      expect(settledFirst.orphanedCycle).toBeNull()
      expect(settledLast.currentRollCycleDice.size).toBe(0)
      expect(settledFirst.currentRollCycleDice.size).toBe(0)
    })

    it('records the survivors whatever order the removed ids arrive in', () => {
      const order = (ids: string[]) => {
        useDiceStore.getState().reset()
        useDiceStore.getState().markDiceRolling(['die-1', 'die-2', 'die-3'])
        // die-2 has landed, die-3 has not — a mixed batch, like Clear All.
        useDiceStore.getState().recordDieSettled('die-2', 5, 'd6')
        removeDice(ids, PLAYER)
        useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
        return useDiceStore.getState().rollHistory
      }

      const forwards = order(['die-2', 'die-3'])
      const backwards = order(['die-3', 'die-2'])

      expect(forwards).toHaveLength(1)
      expect(backwards).toHaveLength(1)
      expect(forwards[0].sum).toBe(3)
      expect(backwards[0].sum).toBe(3)
      expect(forwards[0].dice.map((d) => d.diceId)).toEqual(['die-1'])
      expect(backwards[0].dice.map((d) => d.diceId)).toEqual(['die-1'])
    })

    it('attributes the row to whoever owned the roll', () => {
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      useDiceStore.getState().recordDieSettled('die-1', 2, 'd6')

      removeDice(['die-2'], PLAYER)

      expect(useDiceStore.getState().rollHistory[0].player?.displayName).toBe('Me')
    })

    it('ignores a removal of dice no roll of ours ever claimed', () => {
      // Issue #221: a rival's dice never enter our cycle, so trashing them says
      // nothing about our roll and must not orphan it. Their roll is recorded
      // by its own `roll_complete`, whoever removes what.
      useDiceStore.getState().markDiceRolling(['their-1', 'their-2'], { ownRoll: false })
      useDiceStore.getState().recordDieSettled('their-1', 2, 'd6')

      removeDice(['their-2'], { id: 'p2', displayName: 'Rival', color: '#0f0' })

      expect(useDiceStore.getState().orphanedCycle).toBeNull()
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
    })

    it('leaves OUR wave sequence alone while a rival\'s dice come and go', () => {
      // The claim speaks for our roll; a rival's dice are outside the cycle
      // entirely, so neither their roll nor its removal can spend it.
      useDiceStore.getState().beginSavedRollWaves(['mine-1'])
      useDiceStore.getState().markDiceRolling(['mine-1'])
      useDiceStore.getState().markDiceRolling(['their-1', 'their-2'], { ownRoll: false })

      removeDice(['their-2'], { id: 'p2', displayName: 'Rival', color: '#0f0' })

      expect(useDiceStore.getState().orphanedCycle).toBeNull()
      expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['mine-1'])
      expect([...useDiceStore.getState().currentRollCycleDice]).toEqual(['mine-1'])
    })

    it('records nothing when the die leaves an already-settled table', () => {
      // The common case: the cycle closed on drain and `roll_complete` already
      // wrote the row, so tidying the table must not add a second one.
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')

      removeDice(['die-1'], PLAYER)

      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
      expect(useDiceStore.getState().orphanedCycle).toBeNull()
    })

    it('leaves wave removals alone — a reroll drops its own claimed dice', () => {
      useDiceStore.getState().beginSavedRollWaves(['die-1'])
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 1, 'd6')

      removeDice(['die-1'], PLAYER)

      expect(useDiceStore.getState().orphanedCycle).toBeNull()
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
    })

    it('records the roll when the removal itself stills the table', () => {
      // Trashing the last die in the air ends the roll; no settle follows to
      // notice, so the removal has to close the cycle itself.
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')

      removeDice(['die-2'], PLAYER)

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['die-1'])
      expect(history[0].sum).toBe(4)
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
    })

    it('records nothing when every die of the roll is removed', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])

      removeDice(['die-1'], PLAYER)

      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
    })

    it('does not survive into the next roll', () => {
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      removeDice(['die-2'], PLAYER)
      expect(useDiceStore.getState().orphanedCycle).not.toBeNull()

      // A fresh roll supersedes the abandoned one; its row belongs to
      // `roll_complete` again.
      useDiceStore.getState().removeDieState('die-1')
      useDiceStore.getState().markDiceRolling(['die-9'])
      expect(useDiceStore.getState().orphanedCycle).toBeNull()

      useDiceStore.getState().recordDieSettled('die-9', 4, 'd6')
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)
    })
  })

  describe('the room\'s completion of a shrunk roll (issue #226)', () => {
    const PLAYER = { id: 'p1', displayName: 'Me', color: '#f00' }

    /**
     * Roll two dice, land one, and trash the other — the shape a current room
     * completes from its survivors. Leaves the provisional row written.
     */
    function shrunkRollWithProvisionalRow() {
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      useDiceStore.getState().applyDiceRemoval(['die-2'], PLAYER)
      return useDiceStore.getState().rollHistory[0]
    }

    /** The room's word for the surviving die. */
    const completion = {
      dice: [{ diceId: 'die-1', value: 4, type: 'd6', settledAt: 1 }],
      sum: 4,
      timestamp: 2,
      player: PLAYER,
    }

    it('replaces the provisional row instead of adding a second one', () => {
      const provisional = shrunkRollWithProvisionalRow()
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)

      useDiceStore.getState().recordRoomCompletedRoll(completion)

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      // In place: same row, same React identity, the room's values.
      expect(history[0].id).toBe(provisional.id)
      expect(history[0].sum).toBe(4)
      expect(history[0].timestamp).toBe(2)
      expect(useDiceStore.getState().provisionalRollRowId).toBeNull()
    })

    it('leaves the row alone when NO completion comes (an older room)', () => {
      // The fallback the orphan path still exists for: a room that cancels
      // `pending_roll` on removal never sends this, and the provisional row is
      // the roll's only trace. Exactly one row either way.
      shrunkRollWithProvisionalRow()

      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      expect(useDiceStore.getState().rollHistory[0].sum).toBe(4)
      expect(useDiceStore.getState().rollHistory[0].player?.id).toBe('p1')
    })

    it('supersedes only ONCE, so a repeat completion still appends', () => {
      shrunkRollWithProvisionalRow()

      useDiceStore.getState().recordRoomCompletedRoll(completion)
      useDiceStore.getState().recordRoomCompletedRoll(completion)

      expect(useDiceStore.getState().rollHistory).toHaveLength(2)
    })

    it('appends an ordinary roll, with no provisional row in play', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().provisionalRollRowId).toBeNull()

      useDiceStore.getState().recordRoomCompletedRoll(completion)

      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
    })

    it('does not swallow a DIFFERENT roll\'s completion', () => {
      // Negative control: a rival finishing their roll while our provisional
      // row waits must add their row, not overwrite ours.
      shrunkRollWithProvisionalRow()

      useDiceStore.getState().recordRoomCompletedRoll({
        dice: [{ diceId: 'theirs', value: 6, type: 'd6', settledAt: 1 }],
        sum: 6,
        timestamp: 3,
        player: { id: 'p2', displayName: 'Rival', color: '#0f0' },
      })

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(2)
      expect(history[0].sum).toBe(4)
      expect(history[1].sum).toBe(6)
      // Ours is still claimable — the completion we are waiting for may follow.
      expect(useDiceStore.getState().provisionalRollRowId).toBe(history[0].id)
    })

    it('does not let a LATER roll of the same table cannibalise the row', () => {
      // The reason the mark is scoped to one cycle: re-rolling an unchanged
      // table presents the very same dice ids, and that roll's completion must
      // join history rather than overwrite the older row.
      shrunkRollWithProvisionalRow()

      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().provisionalRollRowId).toBeNull()
      useDiceStore.getState().recordDieSettled('die-1', 6, 'd6')
      useDiceStore.getState().recordRoomCompletedRoll({ ...completion, sum: 6 })

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(2)
      expect(history[0].sum).toBe(4)
      expect(history[1].sum).toBe(6)
    })

    it('drops the mark with the history it pointed into', () => {
      shrunkRollWithProvisionalRow()

      useDiceStore.getState().clearHistory()
      useDiceStore.getState().recordRoomCompletedRoll(completion)

      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
    })
  })

  describe('history row identity', () => {
    it('gives every row a unique id, whichever writer recorded it', () => {
      // Same-millisecond rolls used to collide as duplicate React keys because
      // the list keyed on `timestamp` (issue #211).
      const timestamp = Date.now()
      useDiceStore.getState().addRollToHistory({ dice: [], sum: 1, timestamp })
      useDiceStore.getState().addRollToHistory({ dice: [], sum: 2, timestamp })
      asWaveRoll(() => {
        useDiceStore.getState().markDiceRolling(['die-1'])
        useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      })

      const ids = useDiceStore.getState().rollHistory.map((roll) => roll.id)
      expect(ids).toHaveLength(3)
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
      expect(new Set(ids).size).toBe(3)
    })
  })

  describe('persist migration to v1', () => {
    async function rehydrateFrom(stored: unknown) {
      window.localStorage.setItem('dicesuki-dice-rolls', JSON.stringify(stored))
      await useDiceStore.persist.rehydrate()
    }

    afterEach(() => {
      window.localStorage.removeItem('dicesuki-dice-rolls')
    })

    it('backfills a unique id on every id-less stored row', async () => {
      // v0 rows have no `id`; the list keyed on `timestamp`, so two rows written
      // in the same millisecond collided as duplicate React keys.
      await rehydrateFrom({
        version: 0,
        state: {
          rollHistory: [
            { dice: [], sum: 1, timestamp: 1_700_000_000_000 },
            { dice: [], sum: 2, timestamp: 1_700_000_000_000 },
          ],
        },
      })

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(2)
      expect(history.map((roll) => roll.sum)).toEqual([1, 2])
      expect(history.every((roll) => typeof roll.id === 'string' && roll.id.length > 0)).toBe(true)
      expect(new Set(history.map((roll) => roll.id)).size).toBe(2)
    })

    it('keeps ids that are already present', async () => {
      await rehydrateFrom({
        version: 0,
        state: { rollHistory: [{ id: 'roll_kept', dice: [], sum: 3, timestamp: 1 }] },
      })

      expect(useDiceStore.getState().rollHistory[0].id).toBe('roll_kept')
    })

    it('survives a null payload', async () => {
      await rehydrateFrom({ version: 0, state: null })
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('survives an empty payload', async () => {
      await rehydrateFrom({ version: 0, state: {} })
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })
  })

  describe('reset', () => {
    it('should clear everything including activeSavedRoll', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().markDiceRolling(['die-2'])
      useDiceStore.getState().markDiceRolling(['die-3'])
      useDiceStore.getState().recordDieSettled('die-3', 5, 'd6')
      useDiceStore.getState().setActiveSavedRoll({
        name: 'Test Roll',
        flatBonus: 2,
        perDieBonuses: new Map([['die-1', 1]]),
      })
      // A shrunk roll leaves a mark pointing into history; both must go.
      useDiceStore.getState().markDiceRolling(['die-4', 'die-5'])
      useDiceStore.getState().recordDieSettled('die-4', 2, 'd6')
      // die-2 is the cycle's last die in the air; the removal below can only
      // close the cycle (and write the provisional row) once it lands.
      useDiceStore.getState().recordDieSettled('die-2', 1, 'd6')
      useDiceStore.getState().applyDiceRemoval(['die-5'], { id: 'p1', displayName: 'Me', color: '#f00' })
      expect(useDiceStore.getState().provisionalRollRowId).not.toBeNull()

      useDiceStore.getState().reset()

      const state = useDiceStore.getState()
      expect(state.settledDice.size).toBe(0)
      expect(state.rollingDice.size).toBe(0)
      expect(state.currentRollCycleDice.size).toBe(0)
      expect(state.rollHistory).toEqual([])
      expect(state.activeSavedRoll).toBeNull()
      expect(state.provisionalRollRowId).toBeNull()
    })
  })
})
