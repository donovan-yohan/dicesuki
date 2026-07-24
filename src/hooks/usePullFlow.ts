import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PullCount,
  PullRevealAssembly,
  PullRevealSummary,
  PullVerificationDisclosure,
} from '../types/pull'
import {
  HOLD_ESCALATION_MS,
  INITIAL_PULL_FLOW_STATE,
  MIN_SEALING_MS,
  clearPersistedPullSession,
  createPullIntent,
  derivePullVerification,
  persistPullSession,
  readPersistedPullSession,
  reducePullFlow,
  summarizePullReveal,
  toPersistedPullSession,
  type PullFlowEvent,
  type PullFlowState,
  type PullInventorySnapshot,
} from '../lib/pullFlow'
import {
  PullRpcError,
  cancelPullSession,
  commitPullSession,
  getCommittedPullReveal,
  preparePull,
} from '../lib/pullRpc'
import { assemblePullReveal } from '../lib/pullFlow'
import { refreshPullInventory } from '../lib/pullInventoryRefresh'

export interface UsePullFlowOptions {
  client: SupabaseClient | null
  ownerId: string | null
  inventoryRefresh?: (client: SupabaseClient) => Promise<PullInventorySnapshot>
  now?: () => number
}

export interface UsePullFlowResult {
  state: PullFlowState
  assembly: PullRevealAssembly | null
  summary: PullRevealSummary | null
  verification: PullVerificationDisclosure | null
  inventoryRefreshError: string | null
  isBusy: boolean
  startPull: (bannerVersionId: string, pullCount: PullCount) => Promise<void>
  retryPrepare: () => Promise<void>
  retryRestore: () => Promise<void>
  revealNow: () => Promise<void>
  resume: () => Promise<void>
  expire: () => Promise<void>
  cancel: () => Promise<void>
  clearReveal: () => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown pull failure'
}

function delay(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise(resolve => setTimeout(resolve, ms))
}

export function usePullFlow(options: UsePullFlowOptions): UsePullFlowResult {
  const [state, dispatch] = useReducer(reducePullFlow, INITIAL_PULL_FLOW_STATE)
  const stateRef = useRef(state)
  const generationRef = useRef(0)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoResumeOwnerRef = useRef<string | null>(null)
  const previousOwnerRef = useRef<string | null>(options.ownerId)
  const [assembly, setAssembly] = useState<PullRevealAssembly | null>(null)
  const [inventoryRefreshError, setInventoryRefreshError] = useState<string | null>(null)
  const now = options.now ?? Date.now
  const refreshInventory = options.inventoryRefresh ?? refreshPullInventory

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const send = useCallback((event: PullFlowEvent) => {
    stateRef.current = reducePullFlow(stateRef.current, event)
    dispatch(event)
  }, [])

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer])

  const finishReveal = useCallback(async (
    reveal: Awaited<ReturnType<typeof commitPullSession>>,
    generation: number,
    minimumRevealAt: number,
  ) => {
    const current = stateRef.current
    const preparation = current.status === 'restoring'
      ? current.persisted.preparation
      : current.status === 'sealing' ||
          current.status === 'hold' ||
          current.status === 'cancelling' ||
          current.status === 'expiring'
        ? current.preparation
        : null
    const intent = current.status === 'restoring'
      ? current.persisted.intent
      : current.status === 'sealing' ||
          current.status === 'hold' ||
          current.status === 'cancelling' ||
          current.status === 'expiring'
        ? current.intent
        : null
    if (!preparation || !intent || generation !== generationRef.current) return
    if (
      reveal.sessionId !== preparation.sessionId ||
      reveal.bannerVersionId !== preparation.bannerVersionId ||
      reveal.pullCount !== preparation.pullCount ||
      reveal.commitmentRoot !== preparation.commitmentRoot
    ) {
      const error = 'Committed receipt does not match the prepared pull.'
      if (current.status === 'restoring') {
        send({ type: 'RESTORE_FAILED', intent, error })
      } else if (current.status === 'expiring') {
        send({ type: 'EXPIRE_FAILED', error })
      } else if (current.status === 'cancelling') {
        send({ type: 'CANCEL_FAILED', error })
      } else {
        send({ type: 'COMMIT_FAILED', error })
      }
      return
    }

    await delay(Math.max(0, minimumRevealAt - now()))
    if (generation !== generationRef.current) return
    clearHoldTimer()
    persistPullSession(toPersistedPullSession(intent, preparation, 'committed'))
    send({ type: 'REVEALED', reveal })
    setAssembly(null)
    setInventoryRefreshError(null)
    try {
      const inventory = await refreshInventory(options.client!)
      if (generation !== generationRef.current) return
      setAssembly(assemblePullReveal(reveal, inventory))
    } catch (error) {
      if (generation === generationRef.current) {
        setInventoryRefreshError(message(error))
      }
    }
  }, [clearHoldTimer, now, options.client, refreshInventory, send])

  const commitPrepared = useCallback(async (
    sessionId: string,
    generation: number,
    minimumRevealAt: number,
  ) => {
    if (!options.client) return
    try {
      const reveal = await commitPullSession(options.client, sessionId)
      await finishReveal(reveal, generation, minimumRevealAt)
    } catch (error) {
      if (generation !== generationRef.current) return
      send({ type: 'COMMIT_FAILED', error: message(error) })
    }
  }, [finishReveal, options.client, send])

  const prepareIntent = useCallback(async (
    intent: ReturnType<typeof createPullIntent>,
  ) => {
    if (!options.client || !options.ownerId || intent.ownerId !== options.ownerId) return
    const generation = ++generationRef.current
    clearHoldTimer()
    setAssembly(null)
    setInventoryRefreshError(null)
    persistPullSession(toPersistedPullSession(intent, null, 'intent'))
    send({ type: 'START', intent })
    try {
      const preparation = await preparePull(options.client, {
        bannerVersionId: intent.bannerVersionId,
        pullCount: intent.pullCount,
        idempotencyKey: intent.idempotencyKey,
      })
      if (generation !== generationRef.current) return
      persistPullSession(toPersistedPullSession(intent, preparation, 'prepared'))
      const sealingStartedAt = now()
      send({ type: 'PREPARED', receipt: preparation, sealingStartedAt })
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null
        if (generation === generationRef.current) send({ type: 'HOLD_SLOW' })
      }, HOLD_ESCALATION_MS)
      void commitPrepared(
        preparation.sessionId,
        generation,
        sealingStartedAt + MIN_SEALING_MS,
      )
    } catch (error) {
      if (generation === generationRef.current) {
        send({ type: 'PREPARE_FAILED', error: message(error) })
      }
    }
  }, [
    clearHoldTimer,
    commitPrepared,
    now,
    options.client,
    options.ownerId,
    send,
  ])

  const startPull = useCallback(async (
    bannerVersionId: string,
    pullCount: PullCount,
  ) => {
    if (!options.client || !options.ownerId) return
    const current = stateRef.current
    if (
      current.status !== 'idle' &&
      current.status !== 'error' &&
      current.status !== 'cancelled' &&
      current.status !== 'expired'
    ) return
    await prepareIntent(createPullIntent({
      ownerId: options.ownerId,
      bannerVersionId,
      pullCount,
      now: now(),
    }))
  }, [now, options.client, options.ownerId, prepareIntent])

  const retryPrepare = useCallback(async () => {
    const current = stateRef.current
    if (current.status !== 'error' || current.stage !== 'prepare') return
    await prepareIntent(current.intent)
  }, [prepareIntent])

  const revealNow = useCallback(async () => {
    const current = stateRef.current
    if (
      !options.client ||
      (current.status !== 'hold' && current.status !== 'sealing')
    ) return
    const generation = ++generationRef.current
    clearHoldTimer()
    await commitPrepared(current.preparation.sessionId, generation, now())
  }, [clearHoldTimer, commitPrepared, now, options.client])

  const expirePrepared = useCallback(async (source: {
    intent: ReturnType<typeof createPullIntent>
    preparation: Awaited<ReturnType<typeof preparePull>>
  }) => {
    if (!options.client || !options.ownerId) return
    const generation = ++generationRef.current
    clearHoldTimer()
    send({
      type: 'EXPIRE_STARTED',
      intent: source.intent,
      preparation: source.preparation,
    })

    // Never wait on a client transport promise: it may never settle. The
    // durable read plus serialized commit fence below are the authority. After
    // TTL the fence cannot create a new commit, but server-side account locking
    // makes it wait behind any pre-deadline commit that can still win.
    try {
      const reveal = await getCommittedPullReveal(
        options.client,
        source.preparation.sessionId,
      )
      await finishReveal(reveal, generation, now())
    } catch (error) {
      if (generation !== generationRef.current) return
      if (!(error instanceof PullRpcError) || error.code !== '55000') {
        send({ type: 'EXPIRE_FAILED', error: message(error) })
        return
      }
      try {
        const reveal = await commitPullSession(
          options.client,
          source.preparation.sessionId,
        )
        await finishReveal(reveal, generation, now())
      } catch (fenceError) {
        if (generation !== generationRef.current) return
        if (fenceError instanceof PullRpcError && fenceError.code === '55000') {
          clearPersistedPullSession(options.ownerId)
          send({ type: 'EXPIRED_CONFIRMED' })
        } else {
          send({ type: 'EXPIRE_FAILED', error: message(fenceError) })
        }
      }
    }
  }, [
    clearHoldTimer,
    finishReveal,
    now,
    options.client,
    options.ownerId,
    send,
  ])

  const resume = useCallback(async () => {
    if (!options.client || !options.ownerId) return
    const persisted = readPersistedPullSession(options.ownerId)
    if (!persisted) return
    if (persisted.status === 'intent') {
      await prepareIntent(persisted.intent)
      return
    }
    const preparation = persisted.preparation!

    const generation = ++generationRef.current
    clearHoldTimer()
    send({ type: 'RESTORE_STARTED', persisted })
    try {
      const reveal = await getCommittedPullReveal(
        options.client,
        preparation.sessionId,
      )
      await finishReveal(reveal, generation, now())
    } catch (error) {
      if (generation !== generationRef.current) return
      if (
        persisted.status === 'prepared' &&
        error instanceof PullRpcError &&
        error.code === '55000'
      ) {
        if (Date.parse(preparation.expiresAt) <= now()) {
          await expirePrepared({
            intent: persisted.intent,
            preparation,
          })
        } else {
          send({
            type: 'RESTORE_HOLD',
            intent: persisted.intent,
            preparation,
          })
        }
      } else {
        send({
          type: 'RESTORE_FAILED',
          intent: persisted.intent,
          error: message(error),
        })
      }
    }
  }, [
    clearHoldTimer,
    finishReveal,
    expirePrepared,
    now,
    options.client,
    options.ownerId,
    prepareIntent,
    send,
  ])

  const retryRestore = useCallback(async () => {
    const current = stateRef.current
    if (
      current.status !== 'error' ||
      current.stage !== 'restore' ||
      !options.client ||
      !options.ownerId
    ) return
    await resume()
  }, [options.client, options.ownerId, resume])

  const expire = useCallback(async () => {
    const current = stateRef.current
    const source = current.status === 'restoring'
      ? current.persisted.preparation
        ? {
            intent: current.persisted.intent,
            preparation: current.persisted.preparation,
          }
        : null
      : current.status === 'sealing' ||
          current.status === 'hold' ||
          current.status === 'cancelling'
        ? { intent: current.intent, preparation: current.preparation }
        : null
    if (!source) return
    await expirePrepared(source)
  }, [expirePrepared])

  const cancel = useCallback(async () => {
    const current = stateRef.current
    if (
      !options.client ||
      !options.ownerId ||
      (current.status !== 'sealing' && current.status !== 'hold')
    ) return
    if (Date.parse(current.preparation.expiresAt) <= now()) {
      await expire()
      return
    }
    const generation = ++generationRef.current
    clearHoldTimer()
    send({ type: 'CANCEL_STARTED' })
    try {
      await cancelPullSession(options.client, current.preparation.sessionId)
      if (generation !== generationRef.current) return
      clearPersistedPullSession(options.ownerId)
      send({ type: 'CANCELLED' })
    } catch (error) {
      if (generation !== generationRef.current) return
      // Commit/cancel can race. If commit won, restore the durable reveal
      // instead of claiming that cancellation failed or that the pull vanished.
      if (error instanceof PullRpcError && error.code === '55000') {
        try {
          const reveal = await getCommittedPullReveal(
            options.client,
            current.preparation.sessionId,
          )
          await finishReveal(reveal, generation, now())
          return
        } catch {
          // Preserve the session and return to HOLD below.
        }
      }
      send({ type: 'CANCEL_FAILED', error: message(error) })
    }
  }, [
    clearHoldTimer,
    finishReveal,
    now,
    options.client,
    options.ownerId,
    send,
    expire,
  ])

  const clearReveal = useCallback(() => {
    const current = stateRef.current
    // A restore error may describe a committed session whose response was
    // temporarily unreadable. Preserve its durable resume pointer.
    if (current.status === 'error' && current.stage === 'restore') return
    if (
      current.status === 'revealed' ||
      current.status === 'cancelled' ||
      current.status === 'expired' ||
      current.status === 'error'
    ) {
      generationRef.current += 1
      clearHoldTimer()
      if (options.ownerId) clearPersistedPullSession(options.ownerId)
      setAssembly(null)
      setInventoryRefreshError(null)
      send({ type: 'CLEAR' })
    }
  }, [clearHoldTimer, options.ownerId, send])

  useEffect(() => {
    if (
      options.ownerId &&
      options.client &&
      autoResumeOwnerRef.current !== options.ownerId
    ) {
      autoResumeOwnerRef.current = options.ownerId
      void resume()
    }
    if (!options.ownerId) autoResumeOwnerRef.current = null
  }, [options.client, options.ownerId, resume])

  useEffect(() => {
    const previousOwner = previousOwnerRef.current
    previousOwnerRef.current = options.ownerId
    if (!previousOwner || options.ownerId) return

    const current = stateRef.current
    const persisted = current.status === 'preparing'
      ? toPersistedPullSession(current.intent, null, 'intent')
      : current.status === 'sealing' ||
          current.status === 'hold' ||
          current.status === 'cancelling' ||
          current.status === 'expiring'
        ? toPersistedPullSession(current.intent, current.preparation, 'prepared')
        : current.status === 'restoring'
          ? current.persisted
          : current.status === 'revealed'
            ? toPersistedPullSession(current.intent, current.preparation, 'committed')
            : readPersistedPullSession(previousOwner)
    if (!persisted) return

    generationRef.current += 1
    clearHoldTimer()
    persistPullSession(persisted)
    send({ type: 'AUTH_REQUIRED', persisted })
  }, [clearHoldTimer, options.ownerId, send])

  const summary = useMemo(
    () => state.status === 'revealed' ? summarizePullReveal(state.reveal) : null,
    [state],
  )
  const verification = useMemo(
    () => state.status === 'revealed' ? derivePullVerification(state.reveal) : null,
    [state],
  )
  const isBusy = [
    'preparing',
    'sealing',
    'hold',
    'restoring',
    'expiring',
    'auth-required',
    'cancelling',
  ].includes(state.status)

  return {
    state,
    assembly,
    summary,
    verification,
    inventoryRefreshError,
    isBusy,
    startPull,
    retryPrepare,
    retryRestore,
    revealNow,
    resume,
    expire,
    cancel,
    clearReveal,
  }
}
