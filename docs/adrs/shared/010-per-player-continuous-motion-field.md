# ADR 010 - Per-Player Continuous Motion Field (Own-Dice Dice-Box)

* Date: 2026/07/15
* Amended: 2026/07/16 — fused-orientation tilt is composed into the same per-player field.
* Status: Accepted
* Deciders: Donovan, Development Team
* Supersedes: the discrete `motion_impulse` shake channel introduced for rooms (the "mobile shake-to-roll" feature) — replaced by a continuous field.
* Amends: [ADR 004 - Multiplayer Drag Interaction](004-multiplayer-drag-interaction-architecture.md) and [ADR 005 - Room-First Architecture](005-room-first-local-loopback-architecture.md) (device motion becomes a first-class, tested room channel, applied per-tick like drag) · [ADR 007 - WASM Room Core](007-wasm-room-core-single-source.md) (adds engine constants for the motion field; the client's sensor→field mapping stays client-side config).

## Context

The original single-player simulator had a beloved "dice box" feel: moving the
phone made the dice slide and tumble inside the tray, as if you were shaking a
physical dice box — *"move the box fast and the floor slides out from under the
dice."* An archaeology pass (git `53fae1f^`) found the original mechanism was a
**non-inertial reference frame**: the phone's linear acceleration was folded into
the Rapier **world gravity** every frame (`effective gravity = tilt + pseudo-force`),
and finite die/floor friction produced the slide.

Two facts shape this decision:

1. **The feel was never ported to the room model.** The solo→room unification
   (ADR 005/007) carried over only a *discrete* shake-to-roll: one magnitude-clamped
   `motion_impulse` fired on the rising edge of a shake. The continuous "shaking box"
   behavior does not exist in the room path, and **no test at any layer asserts that a
   die actually moves in response to motion** — the physics effect is entirely
   unverified.

2. **World gravity is shared; the effect must not be.** In a multiplayer room the
   arena and its gravity are one shared, server-authoritative surface (ADR 004/005;
   ADR 009 kept *size* shared and made only *orientation* per-client). N players cannot
   each swing one shared gravity vector. The product requirement is explicit: **device-
   motion effects — in solo and multiplayer alike — MUST affect only the local player's
   own dice.** Each player shakes *their own* dice box.

The load-bearing distinction is unchanged by the tilt amendment: the effect is a
**per-die acceleration scoped to the sender's own dice**, never a change to shared
world gravity. The field combines movement of the box (linear acceleration) with a
gravity-direction correction from fused device orientation.

## Decision

### A. Device motion is a continuous, per-player motion field over own dice

* The room protocol MUST carry device motion as a **continuous** client→server
  message `motion_field` with `field: [f32; 3]` — a per-die acceleration in engine
  units (U/s²), expressed in world space. It supersedes the discrete `motion_impulse`
  message, which MUST be removed (one motion model, per the "continuous only"
  decision).
* The field combines two client-derived terms: (1) the **non-inertial pseudo-force**
  opposite the phone's linear acceleration, scaled by client sensor constants; and
  (2) a **tilt gravity correction** derived from `DeviceOrientationEvent`'s fused
  accelerometer/gyroscope orientation. The correction is `desiredTiltedGravity −
  sharedGravity`, using the room-delivered engine gravity. A flat, still phone sends
  zero; at 90° the correction cancels downward gravity and replaces it horizontally
  for only the affected dice.
* The server MUST apply the field **every physics tick** (60Hz), before `step()`, as
  a mass-scaled velocity delta (`field × dt`) to exactly the dice the sender may
  affect under `Room::can_apply_motion` — i.e. the sender's own dice (and, for the
  delegated roller, room-wide), gated by the room's `motionControl` policy
  (`off` / `own_dice` / `room`). It MUST NEVER modify the shared world gravity.
* A player's field is **latched with a staleness timeout**: the server stores the
  last `field` per player and keeps applying it each tick until a new one arrives or
  `MOTION_FIELD_STALE_MS` elapses with no update, after which it clears. The client
  sends updates while motion is active (throttled) and a single zero field when motion
  is disabled, so dice stop promptly.
* Solo and multiplayer MUST use this identical path (one engine; solo is a one-player
  room). No behavior fork in core.

### B. Engine authority and safety

* `field` MUST be magnitude-clamped server-side to `MOTION_FIELD_MAX_ACCEL` (an engine
  constant in `physics.rs`) so a miscalibrated or malicious client cannot fling dice;
  the existing per-tick velocity clamp (`MAX_DICE_VELOCITY`) remains the final bound.
* Motion-field constants (`MOTION_FIELD_MAX_ACCEL`, `MOTION_FIELD_STALE_MS`) MUST live
  once in `dicesuki-core` (`physics.rs`), be projected through `EngineConfig`
  (ADR 007), and be drift-guarded (`config.rs` assertion + the client guard test).
  The client's sensor→field mapping (which m/s² of hand motion becomes how much U/s²)
  is a **client** concern and stays in `src/config/physicsConfig.ts` (ADR 003/007).
* Field presence alone MUST NOT invalidate a settled face: persistent tilt can be
  balanced by contacts. A settled die re-enters the settle pipeline only when the
  existing speed/orientation knock evidence proves that it actually moved or tipped.

### C. Testing (closes the coverage gap)

* Core MUST have tests that **step the simulation and assert dice velocity/position
  change** under a motion field, and that the change is scoped to own dice under each
  `motionControl` policy, plus latch/staleness behavior. The client MUST test the
  sensor→field mapping and the send/opt-in gating.

## Alternatives Considered

* **Restore shared world-gravity swing (the original mechanism).** Rejected because
  one shared vector cannot represent several players' simultaneous tilt. The adopted
  per-die correction recreates the effective direction without mutating shared gravity.
* **Move the arena colliders (kinematic dice box).** Physically the truest "floor
  slides out" mechanic, but the arena is shared, colliders are `fixed()` (no surface
  velocity to drive friction), and the whole downstream model assumes an origin-centered
  arena (escape recovery, spawn, drag clamp). High cost, and still can't scope to one
  player's dice on a shared surface. Rejected.
* **Keep the discrete shake-impulse too.** Rejected per the "continuous only" decision:
  a vigorous shake already produces large continuous fields that tumble dice (rolling),
  so a separate discrete toss is redundant and splits the model.

## Consequences

### Positive

* Restores continuous tilt-and-shake dice-box control, scoped per-player, in both solo
  and multiplayer — no shared-world conflict.
* One unified, tested motion model; removes the untested discrete path and its
  rate-limit/rename baggage.
* Rides the existing per-tick force hook (`apply_drag_forces` sibling) and the existing
  ownership policy (`can_apply_motion`), so the surface area is contained.

### Negative / Considerations

* Continuous per-tick application means an actively-shaken phone keeps dice awake;
  persistent tilt does not eagerly invalidate settled faces, and the staleness latch
  guarantees the field clears if updates stop.
* Streaming a throttled field per player adds a modest continuous message rate while
  motion is engaged (bounded by the client throttle and `motionControl`), versus the
  old one-shot impulse.
* Very gentle sub-knock motion relies on the existing speed/orientation wake thresholds;
  this avoids face churn when contacts balance a persistent tilt field.
