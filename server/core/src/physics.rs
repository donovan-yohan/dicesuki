//! Engine physics constants and the Rapier world.
//!
//! # Single source of truth (epic #111, Shared-ADR-007)
//!
//! Every physics-engine constant lives **here, once**. Both build targets — the
//! native multiplayer server binary and the `wasm32` in-browser room worker —
//! link this same crate, so a value edited in this file provably reaches both
//! with no second file to touch. This supersedes the Shared-ADR-003 "manual
//! sync between `physicsConfig.ts` and Rust" regime: `src/config/physicsConfig.ts`
//! no longer carries engine constants, and the browser reads the values it needs
//! at runtime from [`crate::config::EngineConfig`] (over the room protocol's
//! `room_state.config`, or the wasm `engine_config_json()` getter before a room
//! exists) — never from a copied literal.
//!
//! Each constant documents its purpose, recommended range, and the rationale for
//! its current value (Shared-ADR-003's documentation requirement, retained).
//!
//! # Unit system: real 16 mm die in a real felt tray, real time (SI anchor)
//!
//! | Engine unit | Definition                              | SI value |
//! |-------------|-----------------------------------------|----------|
//! | length `U`  | one d6 edge                             | 0.016 m (1 m = 62.5 U; 1 cm = 0.625 U) |
//! | mass `M`    | the unit cube at collider `density(1.0)`| 4.7e-3 kg (16 mm plastic die, ρ ≈ 1150 kg/m³ ≈ acrylic) |
//! | time `s`    | real second                             | 1 s |
//!
//! Derived units: velocity 1 m/s = 62.5 U/s; gravity 9.81 m/s² = 613.125 U/s²;
//! force 1 M·U/s² = 7.52e-5 N; linear impulse 1 M·U/s = 7.52e-5 N·s;
//! torque impulse 1 M·U²/s = 1.203e-6 N·m·s;
//! d6 moment of inertia I = M·a²/6 = 1/6 M·U² (= 2.005e-7 kg·m² real).
//!
//! For the d6 (mass exactly 1 M): a linear impulse number IS its Δv in U/s, and a
//! torque impulse L gives Δω = 6·L rad/s per axis. Non-d6 convex hulls have
//! mass < 1 M at density 1.0, so linear impulses are applied mass-scaled as
//! target Δv via [`PhysicsWorld::apply_velocity_impulse`] — a hand imparts
//! velocity, not impulse.
//!
//! The arena is the locked 9 × 16 U = 14.4 × 25.6 cm felt-lined tray; material
//! pairs combine with Rapier's default `Average` rule (die↔die = DICE value;
//! die↔arena = (DICE + ARENA)/2). Values 0.625, 18.75, 31.25, 50.0, 62.5,
//! 93.75, 156.25, 218.75 are dyadic — exact in f32.

use rapier3d::prelude::*;

/// Standard gravity acceleration (U/s²) applied to the physics world.
/// - `-613.1` (current): Earth's 9.81 m/s² expressed in engine units —
///   9.81 ÷ 0.016 m/U = 613.125 U/s² (locked; the constant carries a brief
///   rounding to -613.1). At U = 16 mm this is *real* gravity on the real die,
///   not a feel factor.
/// - Recommended range: `-613` (Earth, the physical value) is the anchor; `-490`
///   (Moon-ish, floatier) – `-800` (heavier-than-Earth, snappier) span the
///   plausible tuning band. Magnitude, not sign, is the knob.
pub const GRAVITY: f32 = -613.1;

/// Restitution (bounciness) of the dice material. Die↔die pairs combine to this
/// value via Rapier's `Average` rule; die↔arena averages with [`ARENA_RESTITUTION`].
/// - Range `0.0` (dead) – `1.0` (perfect bounce).
/// - `0.6` (current): the only camera-validated *die* restitution — die↔table
///   χ = 0.6, Kapitaniak et al., Chaos 22:047504 (2012), fit with a point-contact
///   rigid-body model structurally identical to Rapier's (cube-geometry
///   dissipation included). Acrylic-*sphere* data (χ ≈ 0.93) is an upper bound for
///   cubes and is deliberately not used.
pub const DICE_RESTITUTION: f32 = 0.6;

/// Friction coefficient of the dice material. Die↔die pairs combine to this value
/// via `Average`; die↔arena averages with [`ARENA_FRICTION`] to the 0.30 felt pair.
/// - Range `0.0` (ice) – `1.0+` (very grippy).
/// - `0.22` (current): measured acrylic–acrylic kinetic μ = 0.22 (Foerster, Louge,
///   Chang & Allia, Phys. Fluids 6:1108 (1994); Cornell impact table) — acrylic is
///   the material the locked density (ρ ≈ 1150 kg/m³ ≈ PMMA) already assumes, so
///   self-consistency beats the generic-polymer band.
pub const DICE_FRICTION: f32 = 0.22;

/// Restitution (bounciness) of the six arena boundary colliders (floor, ceiling,
/// four walls). Kept separate from [`DICE_RESTITUTION`] so the surface bounce can
/// be tuned independently of the dice material.
/// - `0.0` (current — value unchanged, meaning re-derived): the die↔felt *pair*
///   restitution targets 0.30 (hard-table ceiling 0.6, Kapitaniak 2012;
///   bead-on-surface 0.3–0.4, arXiv:0808.2936; the reproducible drop observable —
///   a die rebounds ~1 cm from a 10 cm drop on felt, e = √(1/10) ≈ 0.32). With the
///   dice material at 0.6 the `Average` rule needs `2 × 0.30 − 0.6 = 0.0` on the
///   surface.
/// - Range `0.0` (dead) – `0.3` (lively). Above this the arena re-acquires a
///   trampoline read the felt does not have; re-solve as `2 · pair − 0.6` if a
///   direct die-on-felt COR measurement lands (see risk 1).
pub const ARENA_RESTITUTION: f32 = 0.0;

/// Friction coefficient of the six arena boundary colliders. Separate from
/// [`DICE_FRICTION`] for the same reason as [`ARENA_RESTITUTION`].
/// - `0.38` (current): the die↔felt *pair* friction targets μ = 0.30 (felt
///   μ ≈ 0.34; fabric-on-polymer kinetic 0.23–0.35), so the `Average` rule needs
///   `2 × 0.30 − 0.22 = 0.38` on the surface. The billiards number (0.2, polished
///   ball on stretched worsted) is the wrong regime for die faces/edges on loose
///   pile.
/// - Range `0.3` (slidey) – `0.6` (grippy). Re-solve as `2 · pair − 0.22` if a
///   tilt-tray slide-angle measurement lands (see risk 1).
pub const ARENA_FRICTION: f32 = 0.38;

/// Linear speed (U/s) below which a die counts as "at rest" for settle detection.
/// - `0.625` (current): the visual-rest band is 0.005–0.02 m/s; its midpoint
///   0.01 m/s × 62.5 U/m = 0.625 U/s (unanimous). This sits ≥ 2.4× above the
///   estimated 120 Hz solver jitter floor, so settles confirm without registering
///   a face while the die still visibly creeps.
/// - Range `0.31`–`1.25` U/s (0.005–0.02 m/s). Larger risks misreads; smaller
///   risks settles that never confirm against the jitter floor (see risk 3).
pub const LINEAR_VELOCITY_THRESHOLD: f32 = 0.625;

/// Angular speed (rad/s) below which a die counts as "at rest" for settle detection.
/// - `0.72` (current): a unified material-point rest criterion — no point of the
///   die may move faster than the linear rest speed. The corner lever is
///   a√3/2 = 0.866 U, so ω_max = 0.625 / 0.866 = 0.72 rad/s, inheriting the same
///   citation as [`LINEAR_VELOCITY_THRESHOLD`]. Far below the 19.5 rad/s
///   face-change bound ([`KNOCK_WAKE_ANGULAR_SPEED`]); floor friction kills
///   sub-tipping spin in milliseconds, so sub-threshold rotation cannot survive
///   the [`REST_DURATION_MS`] window.
/// - Range `0.1`–`0.72` rad/s; tighten toward 0.1 only if pre-read creep is ever
///   visible (correctness is never at stake — see risk 4).
pub const ANGULAR_VELOCITY_THRESHOLD: f32 = 0.72;

/// Duration (ms) a die must stay below the rest thresholds before its face registers.
/// - `500` (keep): a policy debounce, not a physics constant. It exceeds the worst
///   cube teeter time (5–10 · √(a/g) ≈ 0.2–0.4 s at U = 16 mm, g = 613), so a brief
///   mid-roll pause never registers a false face, without feeling sluggish. `1000`+
///   is safer but slower; `<500` risks premature reads.
pub const REST_DURATION_MS: u64 = 500;

/// Linear speed (U/s) above which an already-settled die is treated as "knocked"
/// and must re-detect + rebroadcast its face. Set to the minimum speed that can
/// physically change a settled face, so re-reads below it are provably pointless
/// (well above [`LINEAR_VELOCITY_THRESHOLD`], so settle micro-jitter never re-wakes
/// a resting die).
/// - `15.9` (current): the face-change energy bound v = √(2gΔh) with
///   Δh = a(√2 − 1)/2 = 3.31 mm (the rise to tip a cube onto an edge) = 0.255 m/s
///   × 62.5 = 15.9 U/s. Below it a face change is energetically impossible even via
///   perfect conversion at a wall.
/// - Range `12`–`20` U/s. `<12` re-wakes on sub-tipping jostle (stale-face churn);
///   `>20` can miss a genuine face-changing hit.
pub const KNOCK_WAKE_LINEAR_SPEED: f32 = 15.9;
/// Angular counterpart to [`KNOCK_WAKE_LINEAR_SPEED`] (rad/s): a settled die spun
/// past this by a collision must re-detect its face.
/// - `19.5` (current): the rotational tipping analog of the same energy bound,
///   ω = √(2mgΔh / I_edge) = √(3gΔh / a²) = 19.5 rad/s with the same Δh = 3.31 mm.
///   Below it a spin cannot tip the die onto a new face.
/// - Range `15`–`25` rad/s.
pub const KNOCK_WAKE_ANGULAR_SPEED: f32 = 19.5;
/// Angle (radians) a settled die may rotate away from its settle-time orientation
/// before it is treated as knocked and must re-detect its face. This is the
/// physics-agnostic complement to [`KNOCK_WAKE_LINEAR_SPEED`]/
/// [`KNOCK_WAKE_ANGULAR_SPEED`], which bound *free-impact* speeds: it catches the
/// quasi-static case those cannot — a settled die *slowly bulldozed* by a dragged
/// neighbour (linear and angular speed below both wake thresholds the whole time)
/// that nonetheless tips onto a new face, which would otherwise leave the
/// authoritative `face_value` stale versus the rendered orientation.
/// - `0.3927` (π/8 = 22.5°, current): half of the 45° a cube must rotate to move
///   from one face to the next, so an in-progress face change is caught well
///   before it completes, while staying far above the few-degree solver
///   micro-drift a die exhibits below the rest thresholds. Orientation delta is
///   the sign-agnostic quaternion angle from the stored settle rotation.
/// - Range `0.26`–`0.44` rad (15–25°). Smaller risks waking on micro-drift;
///   larger risks confirming a stale face mid-tip.
pub const SETTLED_ORIENTATION_KNOCK_ANGLE: f32 = std::f32::consts::FRAC_PI_8;

/// Minimum horizontal (XZ-plane) target Δv (U/s) for a button roll. Applied on the
/// d6 (mass 1 M) as a velocity via [`PhysicsWorld::apply_velocity_impulse`], so the
/// number IS the launch speed.
/// - `31.25` (current): the casual tabletop release floor 0.5 m/s (0.5–2.5 m/s
///   band, cf. Kapitaniak 2012) × 62.5 = 31.25 U/s.
/// - Recommended range `19`–`50` U/s (0.3–0.8 m/s).
pub const ROLL_HORIZONTAL_MIN: f32 = 31.25;
/// Maximum horizontal (XZ-plane) target Δv (U/s) for a button roll. See
/// [`ROLL_HORIZONTAL_MIN`].
/// - `93.75` (current): the casual in-tray ceiling 1.5 m/s × 62.5 (faster is a
///   throw, governed by the throw clamps); crosses the 25.6 cm tray in ~0.17 s.
/// - Recommended range `62`–`125` U/s (1.0–2.0 m/s).
pub const ROLL_HORIZONTAL_MAX: f32 = 93.75;
/// Minimum upward (Y) target Δv (U/s) for a button roll.
/// - `18.75` (current): the casual toss vertical band floor 0.3 m/s × 62.5 (hop
///   height v²/2g = 4.6 mm).
/// - Recommended range `18.75`–`50` U/s (0.3–0.8 m/s).
pub const ROLL_VERTICAL_MIN: f32 = 18.75;
/// Maximum upward (Y) target Δv (U/s) for a button roll. See [`ROLL_VERTICAL_MIN`].
/// - `50.0` (current): the casual toss vertical band top 0.8 m/s × 62.5 (hop
///   3.3 cm; the apex clears the lid — see the module sanity check).
/// - Recommended range `18.75`–`50` U/s (0.3–0.8 m/s).
pub const ROLL_VERTICAL_MAX: f32 = 50.0;

/// **The single roll-feel spin truth.** Each axis of a rolled die receives a
/// random target angular velocity (a spin RATE) in
/// `-ROLL_TORQUE_MAGNITUDE ..= ROLL_TORQUE_MAGNITUDE` (rad/s), converted per body
/// to a torque impulse via its actual angular inertia by
/// [`PhysicsWorld::apply_spin_impulse`], so every die type tumbles at the same
/// rate rather than a rate that scales with hull inertia. The hand imparts a spin
/// rate, not a torque.
///
/// - `25.2` (current): the casual hand-spin band *center* 4 rev/s = 25.13 rad/s,
///   per axis. This is the *same physical roll* as the previous torque-impulse
///   formulation (`T = 4.2 M·U²/s`, which gave the d6 a per-axis Δω = 6·T = 25.2
///   rad/s): the constant is now expressed directly as that Δω, so the d6 is
///   numerically unchanged while non-d6 hulls (d4/d20/…), which used to spin
///   several times faster off the raw torque, now match it. SI check: for the d6,
///   I·ω = (1/6)·25.2 = 4.2 torque-impulse units — the old constant. The *only*
///   spin definition in the codebase, reaching solo and multiplayer identically
///   (closing the historical `±1` vs `±5` divergence, issue #117).
/// - Recommended range: `18.8` (gentle, ~3 rev/s) – `31.4` (energetic, ~5 rev/s)
///   rad/s.
pub const ROLL_TORQUE_MAGNITUDE: f32 = 25.2;

/// Base cursor-pursuit gain (1/s) for how aggressively a dragged die chases the
/// cursor: `set_linvel(displacement × gain)`. A control-loop constant, not a
/// mechanics value.
/// - `20.0` (current): τ = 1/gain = 50 ms, the direct-touch attachment latency
///   bound (Ng et al. 2012); gain · dt = 20/60 = 0.33 < 1, so no overshoot.
/// - Recommended range `10`–`30` (1/s).
pub const DRAG_FOLLOW_SPEED: f32 = 20.0;
/// Extra cursor-pursuit gain (1/s) added when a dragged die is far from the cursor
/// (past [`DRAG_DISTANCE_THRESHOLD`]) so it can catch up.
/// - `10.0` (current): the detached-state total gain is 20 + 10 = 30/s (τ = 33 ms);
///   stability (20 + 10)/60 = 0.5 < 1.
/// - Recommended range `5`–`15` (1/s).
pub const DRAG_DISTANCE_BOOST: f32 = 10.0;
/// Distance (U) beyond which [`DRAG_DISTANCE_BOOST`] starts applying.
/// - `3.75` (current): the steady-state lag of the fastest *ordinary* drag
///   (1.2 m/s = 75 U/s) at gain 20 is 75/20 = 3.75 U, so the boost engages only
///   when a die is genuinely left behind rather than merely tracking. The code
///   ramps the boost over [3.75, 7.5] U (6–12 cm).
/// - Recommended range `2.5`–`5` U. Too small pins the boost permanently on and
///   the two-tier chase degenerates.
pub const DRAG_DISTANCE_THRESHOLD: f32 = 3.75;
/// How much cursor motion induces barrel spin (about the drag axis) on a dragged
/// die (torque strength).
/// - `0.0` (current): along-track barrel spin has no physical counterpart for a
///   linearly dragged cube, so the physical value is zero. (A synthetic non-zero
///   value was rejected — physical value or nothing.)
/// - Range `0.0`–`1.0`; non-zero is a deliberate non-physical flourish.
pub const DRAG_SPIN_FACTOR: f32 = 0.0;
/// How much cursor motion induces rolling ("ball on a surface") on a dragged die.
/// - `2.45` (current): anchored to the slip-to-roll grip time of a cube on felt,
///   t = v / (2.5 · μ_pair · g) = 68 ms at the characteristic 0.5 m/s drag with
///   μ_pair = 0.30. `update_drag` keeps the per-message delta and
///   `apply_drag_forces` re-applies it every 60 Hz tick (verified), so
///   dω/dt = 12·F·v and τ = 1/(6F) ⇒ F = 2.45.
/// - Range `1.5`–`3.5`. The windup this once risked (risk 5) is now bounded by
///   [`DRAG_ROLL_ANGULAR_BOUND_FACTOR`].
pub const DRAG_ROLL_FACTOR: f32 = 2.45;
/// Bound on drag-applied angular velocity, as a multiple of a dragged die's
/// actual ground speed: [`crate::room::Room::apply_drag_forces`] skips the drag
/// torque on any tick where the die's angular speed already exceeds
/// `DRAG_ROLL_ANGULAR_BOUND_FACTOR × v_chase` (`v_chase` = the die's actual linear
/// speed this tick, so a hovered or wall-pinned die that barely moves is allowed
/// almost no drag spin — the windup case).
/// - `2.0` (current): the rolling-without-slipping rate ω = v / r for a die
///   pivoting on its contact edge — with the half-edge r = 0.5 U, ω = v / 0.5 =
///   2·v. A dragged die cannot spin faster than a die *rolling* along the table at
///   the same ground speed, so this is the physical ceiling, not a feel factor.
///   It exists because the per-message drag delta ([`DRAG_ROLL_FACTOR`]) is
///   re-applied every 60 Hz tick between the ~30 Hz `drag_move` messages; without
///   the bound it pumps ω up without limit over a long hover-drag (risk 5), which
///   [`DRAG_RELEASE_ANGULAR_DAMPING`] = 1.0 (physical release) no longer masks.
/// - Range `1.0`–`4.0` (× chase speed). Derived from geometry, not tuned.
pub const DRAG_ROLL_ANGULAR_BOUND_FACTOR: f32 = 2.0;
/// Height (U) of the invisible plane a drag is projected onto.
///
/// **Currently unused by the room:** the drag target's y arrives from the client
/// `drag_move` message, so this constant is documentation of the intended plane,
/// kept truthful. It equals the client raycast plane (`DRAG_PLANE_HEIGHT = 2` in
/// `physicsConfig.ts`) whose y the server actually receives.
/// - `2.0` (current): a finger hovering ~3.2 cm above the felt. With the computed
///   per-tick gravity sag at gain 20 (~0.26 U) a face-down dragged die's bottom
///   sits at 2.0 − 0.26 − 0.5 = 1.24 U, clearing a settled die's top (1.0 U).
/// - Recommended range `1.9`–`2.5` U (lower plows dragged dice through settled ones).
pub const DRAG_PLANE_HEIGHT: f32 = 2.0;
/// Minimum per-message cursor movement (U) below which no drag torque is applied,
/// gating out sensor/quantization jitter.
/// - `0.06` (current): capacitive-touch jitter ≈ 1 mm per message = 0.0625 U
///   (unanimous), carried as 0.06. Recommended `0.03`–`0.1` U. (Hoisted from an
///   inline literal per Shared-ADR-007.)
pub const DRAG_MIN_MOVEMENT: f32 = 0.06;
/// Multiplier applied to a die's angular velocity on drag release.
/// - `1.0` (current): a physical release keeps all spin (hands don't brake spin);
///   the physical value is 1.0. The former `0.75` was an artifact compensator for
///   unbounded hover-spin windup (risk 5), kept out of this SI-derived set — the
///   windup is fixed in core, not masked here.
/// - Range `0.5`–`1.0` (below 1.0 is a deliberate non-physical bleed-off). (Hoisted
///   from an inline literal per Shared-ADR-007.)
pub const DRAG_RELEASE_ANGULAR_DAMPING: f32 = 1.0;

/// Scale applied to the drag-release velocity when a throw is computed.
/// - `1.0` (current): the release-kinematics identity — the die leaves at hand
///   speed (unanimous). `0.5` is an artificial gentle throw.
/// - Range `0.5`–`1.0`.
pub const THROW_VELOCITY_SCALE: f32 = 1.0;
/// Upward (Y) velocity (U/s) added on release to give thrown dice a dynamic arc.
/// - `31.25` (current): the drag plane is horizontal, so release history carries
///   ~zero vy; this reinstates the real toss vertical component 0.5 m/s (mid of the
///   0.3–0.8 m/s band) × 62.5 = 31.25 U/s.
/// - Range `18.75`–`50` U/s (0.3–0.8 m/s).
pub const THROW_UPWARD_BOOST: f32 = 31.25;
/// Minimum release speed (U/s) for a drag-release to count as a throw rather than a
/// drop-in-place.
/// - `15.9` (current): the tipping-energy bound 0.255 m/s × 62.5 — below it a
///   release physically cannot act as a throw (it cannot change any face), so
///   classifying it as a placement is lossless. Inside the HCI flick band
///   0.1–0.3 m/s.
/// - Range `6`–`19` U/s (0.1–0.3 m/s).
pub const MIN_THROW_SPEED: f32 = 15.9;
/// Maximum throw speed (U/s); faster releases are capped to prevent unrealistic
/// launches.
/// - `156.25` (current): the top of the casual toss-into-tray band 2.5 m/s × 62.5
///   (UNLV craps 4.5–4.9 m/s is the wrong regime for a 25.6 cm tray). Post-boost
///   √(156.25² + 31.25²) = 159.3 U/s stays below [`MAX_DICE_VELOCITY`]. Equals
///   [`MOTION_IMPULSE_MAX_MAGNITUDE`] (both the fastest real hand launch).
/// - Range `94`–`188` U/s (1.5–3.0 m/s).
pub const MAX_THROW_SPEED: f32 = 156.25;

/// Hard cap on any die's linear speed (U/s), applied continuously so impulses,
/// drags, and throws can never clip a die through a wall.
/// - `218.75` (current): a real ceiling of 3.5 m/s × 62.5 — headroom over every
///   input path (throws ≤ 2.5 m/s + boost, rolls ≤ 1.7 m/s, free-fall from the lid
///   ≈ 1.8 m/s). At 60 Hz this is 3.65 U/tick and 1.82 U/substep versus the 1.0 U
///   wall slabs, so it is tunnel-safe ONLY with CCD enabled on dice
///   (`dice::create_dice_body`) plus the 2 × 120 Hz substeps ([`PHYSICS_SUBSTEPS`]).
/// - Range `188`–`250` U/s (3.0–4.0 m/s).
pub const MAX_DICE_VELOCITY: f32 = 218.75;

/// Minimum interval (ms) between accepted `motion_impulse` messages per player.
/// Device-motion input arriving faster than this is dropped so a shaking phone
/// cannot flood the physics loop.
/// - `50` (≈20Hz, keep): an anti-flood policy above the 3–5 Hz physical shake
///   rate. Recommended `33` (30Hz) – `100` (10Hz).
pub const MOTION_IMPULSE_MIN_INTERVAL_MS: u64 = 50;
/// Maximum magnitude of a single motion impulse, expressed as a target Δv (U/s):
/// applied mass-scaled via [`PhysicsWorld::apply_velocity_impulse`] so a shake
/// imparts the same velocity to every die type. Every incoming impulse is clamped
/// to this length so a miscalibrated/malicious client cannot launch dice out of the
/// arena.
/// - `156.25` (current): the peak hand speed of a vigorous shake, v = 2πfA at
///   4 Hz / 10 cm stroke = 2.5 m/s × 62.5. Equals [`MAX_THROW_SPEED`] (both the
///   fastest real hand launch) and sits under [`MAX_DICE_VELOCITY`].
/// - Range `94`–`188` U/s (1.5–3.0 m/s).
pub const MOTION_IMPULSE_MAX_MAGNITUDE: f32 = 156.25;

/// Ground plane center height (U) of the fixed 9:16 portrait arena: the slab's
/// **center**, so the floor surface sits at y = 0 (the 1 U slab is the 1.6 cm tray
/// base). `-0.5` (keep).
pub const GROUND_Y: f32 = -0.5;
/// Ceiling height (U) of the fixed 9:16 portrait arena — the Y of the ceiling
/// slab's **center**.
/// - `10.5` (current): a virtual containment lid whose underside sits at 16 cm
///   (10 U) above the floor + the slab's `0.5` half-thickness (real trays are open;
///   a 15–20 cm lid is the plausible band). Clearance: the worst roll apex is
///   spawn 6.25 + 50²/(2·613.125) + half-diagonal 0.87 = 9.16 U < 10.0 underside.
///   [`ESCAPE_RESET_MAX_Y`] auto-follows to 18.5. Recommended `9`–`12` U.
pub const CEILING_Y: f32 = 10.5;
/// Arena half-width along X (U): 9 U = 14.4 cm wide total. Consumed by the client
/// for camera fit and wall rendering via [`crate::config::EngineConfig`].
pub const WALL_HALF_X: f32 = 4.5;
/// Arena half-depth along Z (U): 16 U = 25.6 cm deep total. See [`WALL_HALF_X`].
pub const WALL_HALF_Z: f32 = 8.0;
/// Height of the arena's four side walls (U).
/// - `8.0` (keep): [`PhysicsWorld::with_bounds`] centers each wall at
///   `WALL_HEIGHT / 2` with a **half-extent** of `WALL_HEIGHT`, so a wall spans
///   `y ∈ [-4, 12]` — covering the raised ceiling slab top (11.0) with 1 U margin.
///   Recommended `6.0`–`10.0` U.
pub const WALL_HEIGHT: f32 = 8.0;
/// Thickness of the arena's four side walls (U).
/// - `0.5` (keep): a 1 U = 1.6 cm slab. Thin keeps the CCD engagement threshold
///   small; the [`MAX_DICE_VELOCITY`] cap plus dice CCD (`dice::create_dice_body`)
///   keep fast dice from tunnelling it.
pub const WALL_THICKNESS: f32 = 0.5;
/// Extra distance (world units) a die may drift beyond an arena wall before the
/// room teleports it back onto the table. Added to a room's [`ArenaBounds`]
/// half-extents to form the horizontal escape thresholds
/// ([`ArenaBounds::escape_half_x`]/[`ArenaBounds::escape_half_z`]); the vertical
/// thresholds are the fixed [`ESCAPE_RESET_MIN_Y`]/[`ESCAPE_RESET_MAX_Y`].
/// - `8.0` (current): wide enough that normal fast rolls never trip it, tight
///   enough to recover a genuinely tunnelled die within a frame or two.
///   Recommended `4.0`–`12.0`.
pub const ESCAPE_RESET_MARGIN: f32 = 8.0;
/// Lowest Y (world units) a die may reach before the room recovers it: below the
/// ground by [`ESCAPE_RESET_MARGIN`]. Arena height is fixed, so this is constant.
pub const ESCAPE_RESET_MIN_Y: f32 = GROUND_Y - ESCAPE_RESET_MARGIN;
/// Highest Y (world units) a die may reach before the room recovers it: above the
/// ceiling by [`ESCAPE_RESET_MARGIN`]. Arena height is fixed, so this is constant.
pub const ESCAPE_RESET_MAX_Y: f32 = CEILING_Y + ESCAPE_RESET_MARGIN;

// --- Dice spawn fan-out (3-lane drop, real hand-scatter) ---
//
// [`crate::dice::generate_spawn_position`] fans successive dice across three lanes
// and stepped rows so a multi-die (saved-roll) batch never spawns every die inside
// one collider. The lane/row/jitter spacings map to measured hand-scatter at
// U = 16 mm (see each constant); lengths are held at their prior values because
// they already sit inside the real range and touching them would disturb the
// fan-out separation invariant for zero physical gain.

/// Drop height (U) each die spawns at above the table.
/// - `6.25` (current): a hand-drop 10 cm above the felt (8–15 cm band, unanimous)
///   × 62.5 = 6.25 U. Free-fall ≈ 137 ms, impact ≈ 1.34 m/s; the die top clears the
///   raised lid underside. Recommended `5`–`9.4` U (8–15 cm).
pub const SPAWN_HEIGHT: f32 = 6.25;
/// Horizontal (X) spacing between the three spawn lanes (U).
/// - `1.12` (keep): 1.12 U = 1.79 cm center-to-center hand scatter (real-plausible
///   as-is).
pub const SPAWN_LANE_SPACING: f32 = 1.12;
/// Depth (Z) spacing between successive spawn rows (U).
/// - `1.34` (keep): 1.34 U = 2.14 cm row pitch.
pub const SPAWN_ROW_SPACING: f32 = 1.34;
/// Half-width (U) of the uniform random jitter added to each spawn axis, so dice in
/// the same lane/row do not stack perfectly.
/// - `0.22` (keep): ±0.22 U = ±3.5 mm release scatter; the fan-out invariant
///   `SPAWN_LANE_SPACING − 2·SPAWN_JITTER = 1.12 − 0.44 > 0` is preserved.
///   Recommended `0.1`–`0.4` U.
pub const SPAWN_JITTER: f32 = 0.22;
/// Inset (U) kept between the spawn fan-out and the arena walls, so a large batch
/// (up to `MAX_DICE`) never fans a lane/row into or past a wall.
/// - `1.5` (keep): a 2.4 cm inset > half-diagonal 0.87 U + jitter. Clamps lane X to
///   `±(half_x − margin)` and row Z to `half_z − margin`. Recommended `1.0`–`2.5` U.
pub const SPAWN_WALL_MARGIN: f32 = 1.5;
/// Vertical gap (U) between successive spawn layers. When a batch exceeds the
/// lane × row grid that fits the current arena, the overflow dice drop from a
/// higher layer (`y = SPAWN_HEIGHT + layer × SPAWN_LAYER_SPACING`) — a second
/// handful dropped above the first — instead of clamping onto an already-occupied
/// cell (which interpenetrated dice in big batches / small arenas).
/// - `1.5` (current): 2.4 cm, greater than one die edge (1 U) so stacked layers
///   never spawn overlapping. For any in-range arena (aspect ∈ [0.4, 2.4]) the
///   layer-0 grid already holds a full `MAX_DICE` batch, so layering is the
///   guarded overflow, never hit by a legal roll. Recommended `1.25`–`2.0` U.
pub const SPAWN_LAYER_SPACING: f32 = 1.5;

/// Horizontal footprint (floor half-extents, world units) of a room's arena.
///
/// The arena's **height** is fixed by [`GROUND_Y`], [`CEILING_Y`], and
/// [`WALL_HEIGHT`]; only the floor's X/Z half-extents vary so a room can match
/// the aspect ratio of the surface it renders on. Every room owns one of these
/// and builds its walls, escape bounds, and [`crate::config::EngineConfig`] from
/// it, so the client always sees the ACTUAL arena its room is simulating.
///
/// - Default (`half_x = WALL_HALF_X = 4.5`, `half_z = WALL_HALF_Z = 8.0`): the
///   fixed 9:16 portrait arena the native multiplayer server always uses.
/// - Recommended range: constructed only via [`ArenaBounds::from_aspect`], whose
///   aspect clamp keeps half-extents within roughly `[3.8, 9.5]`.
/// - Rationale: solo play runs in the browser, where the viewport aspect varies;
///   fitting the arena to it removes letterboxing while preserving playfield area.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ArenaBounds {
    /// Arena half-width along X (world units).
    pub half_x: f32,
    /// Arena half-depth along Z (world units).
    pub half_z: f32,
}

impl Default for ArenaBounds {
    /// The fixed 9:16 portrait arena ([`WALL_HALF_X`] x [`WALL_HALF_Z`]) — what
    /// the native multiplayer server always uses.
    fn default() -> Self {
        Self { half_x: WALL_HALF_X, half_z: WALL_HALF_Z }
    }
}

impl ArenaBounds {
    /// Fit the arena to a window's `aspect` (= width / height) while preserving
    /// playfield area.
    ///
    /// Area is held at `WALL_HALF_X * WALL_HALF_Z` (= 36 world-unit², the default
    /// arena's quarter-area) so no window shape gains or loses room for dice to
    /// settle: `half_x = sqrt(AREA * aspect)`, `half_z = sqrt(AREA / aspect)`.
    ///
    /// - `aspect` is clamped to `[0.4, 2.4]` before use, bounding the arena to
    ///   sane shapes even for absurd viewports; half-extents then stay within
    ///   roughly `[3.8, 9.5]`.
    /// - Rationale: the canonical portrait aspect `9 / 16 = 0.5625` reproduces
    ///   exactly `half_x = 4.5`, `half_z = 8.0`, so the default arena is a fixed
    ///   point of this fit — solo at 9:16 is identical to multiplayer.
    #[must_use]
    pub fn from_aspect(aspect: f32) -> Self {
        const AREA: f32 = WALL_HALF_X * WALL_HALF_Z;
        let aspect = aspect.clamp(0.4, 2.4);
        Self {
            half_x: (AREA * aspect).sqrt(),
            half_z: (AREA / aspect).sqrt(),
        }
    }

    /// Horizontal (X) escape threshold: how far past the wall on X a die may drift
    /// before the room recovers it. See [`ESCAPE_RESET_MARGIN`].
    #[must_use]
    pub fn escape_half_x(&self) -> f32 {
        self.half_x + ESCAPE_RESET_MARGIN
    }

    /// Horizontal (Z) escape threshold: how far past the wall on Z a die may drift
    /// before the room recovers it. See [`ESCAPE_RESET_MARGIN`].
    #[must_use]
    pub fn escape_half_z(&self) -> f32 {
        self.half_z + ESCAPE_RESET_MARGIN
    }
}

/// Physics substeps run per 60 Hz room tick. Each [`PhysicsWorld::step`] advances
/// the world by `PHYSICS_SUBSTEPS × (1/120 s)` = one 1/60 s tick, halving per-substep
/// travel and gravity injection (Δv ≈ 5.11 U/s per substep at g = 613) so fast dice
/// resolve contacts before tunnelling and the [`LINEAR_VELOCITY_THRESHOLD`] settle
/// margin holds against solver jitter. The room loop still calls `step()` once per
/// tick, so tick count and snapshot cadence are unchanged.
pub const PHYSICS_SUBSTEPS: usize = 2;

pub struct PhysicsWorld {
    pub(crate) rigid_body_set: RigidBodySet,
    pub(crate) collider_set: ColliderSet,
    pub gravity: Vector<f32>,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,
    pub island_manager: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,
    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
    pub query_pipeline: QueryPipeline,
}

impl Default for PhysicsWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl PhysicsWorld {
    #[must_use]
    pub fn new() -> Self {
        Self::with_bounds(ArenaBounds::default())
    }

    /// Build the physics world for an arena of the given horizontal `bounds`.
    /// Ground, ceiling, and the four walls are sized from `bounds`; the arena's
    /// height ([`GROUND_Y`]/[`CEILING_Y`]/[`WALL_HEIGHT`]) is fixed. Solo passes an
    /// aspect-fitted `bounds` ([`ArenaBounds::from_aspect`]); the native
    /// multiplayer server passes [`ArenaBounds::default`].
    #[must_use]
    pub fn with_bounds(bounds: ArenaBounds) -> Self {
        let ArenaBounds { half_x, half_z } = bounds;
        let mut rigid_body_set = RigidBodySet::new();
        let mut collider_set = ColliderSet::new();
        let gravity = vector![0.0, GRAVITY, 0.0];

        // Ground plane
        let ground_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, GROUND_Y, 0.0])
            .build();
        let ground_handle = rigid_body_set.insert(ground_body);
        // Arena surfaces use the ARENA_RESTITUTION / ARENA_FRICTION material, not
        // the dice material. With Rapier's Average combine rule the effective
        // die↔felt pair is restitution 0.30 and friction 0.30 — the real felt-lined
        // tray this recalibration targets.
        let ground_collider = ColliderBuilder::cuboid(half_x + 2.0, 0.5, half_z + 2.0)
            .restitution(ARENA_RESTITUTION)
            .friction(ARENA_FRICTION)
            .build();
        collider_set.insert_with_parent(ground_collider, ground_handle, &mut rigid_body_set);

        // Ceiling — same felt material as the floor (pair die↔felt = 0.30 / 0.30
        // via Average).
        let ceiling_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, CEILING_Y, 0.0])
            .build();
        let ceiling_handle = rigid_body_set.insert(ceiling_body);
        let ceiling_collider = ColliderBuilder::cuboid(half_x + 2.0, 0.5, half_z + 2.0)
            .restitution(ARENA_RESTITUTION)
            .friction(ARENA_FRICTION)
            .build();
        collider_set.insert_with_parent(ceiling_collider, ceiling_handle, &mut rigid_body_set);

        // 4 walls: +X, -X, +Z, -Z
        let walls = [
            (vector![half_x + WALL_THICKNESS, WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, half_z + 2.0]),
            (vector![-(half_x + WALL_THICKNESS), WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, half_z + 2.0]),
            (vector![0.0, WALL_HEIGHT / 2.0, half_z + WALL_THICKNESS], vector![half_x + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
            (vector![0.0, WALL_HEIGHT / 2.0, -(half_z + WALL_THICKNESS)], vector![half_x + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
        ];

        for (pos, half_extents) in walls {
            let wall_body = RigidBodyBuilder::fixed()
                .translation(pos)
                .build();
            let wall_handle = rigid_body_set.insert(wall_body);
            let wall_collider = ColliderBuilder::cuboid(half_extents.x, half_extents.y, half_extents.z)
                .restitution(ARENA_RESTITUTION)
                .friction(ARENA_FRICTION)
                .build();
            collider_set.insert_with_parent(wall_collider, wall_handle, &mut rigid_body_set);
        }

        // One 60 Hz room tick is integrated as PHYSICS_SUBSTEPS × 1/120 s substeps
        // (see `step`), so the per-substep timestep is halved.
        let integration_parameters = IntegrationParameters {
            dt: 1.0 / 120.0,
            ..IntegrationParameters::default()
        };

        Self {
            rigid_body_set,
            collider_set,
            gravity,
            integration_parameters,
            physics_pipeline: PhysicsPipeline::new(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
        }
    }

    /// Step the physics simulation by one 60 Hz room tick: [`PHYSICS_SUBSTEPS`] ×
    /// 1/120 s substeps run back-to-back, so callers still advance the world by
    /// 1/60 s per call (tick count and snapshot cadence are unaffected).
    pub fn step(&mut self) {
        for _ in 0..PHYSICS_SUBSTEPS {
            self.physics_pipeline.step(
                &self.gravity,
                &self.integration_parameters,
                &mut self.island_manager,
                &mut self.broad_phase,
                &mut self.narrow_phase,
                &mut self.rigid_body_set,
                &mut self.collider_set,
                &mut self.impulse_joint_set,
                &mut self.multibody_joint_set,
                &mut self.ccd_solver,
                Some(&mut self.query_pipeline),
                &(),
                &(),
            );
        }
    }

    /// Get position of a rigid body
    #[must_use]
    pub fn get_position(&self, handle: RigidBodyHandle) -> Option<[f32; 3]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let pos = rb.translation();
            [pos.x, pos.y, pos.z]
        })
    }

    /// Get rotation (quaternion) of a rigid body
    #[must_use]
    pub fn get_rotation(&self, handle: RigidBodyHandle) -> Option<[f32; 4]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let rot = rb.rotation();
            [rot.i, rot.j, rot.k, rot.w]
        })
    }

    /// Get linear velocity magnitude
    #[must_use]
    pub fn get_linear_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map_or(0.0, |rb| rb.linvel().magnitude())
    }

    /// Get angular velocity magnitude
    #[must_use]
    pub fn get_angular_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map_or(0.0, |rb| rb.angvel().magnitude())
    }

    /// Check if a body is at rest (below velocity thresholds)
    #[must_use]
    pub fn is_at_rest(&self, handle: RigidBodyHandle) -> bool {
        self.get_linear_speed(handle) < LINEAR_VELOCITY_THRESHOLD
            && self.get_angular_speed(handle) < ANGULAR_VELOCITY_THRESHOLD
    }

    /// Check if a body has been "knocked" — i.e. it is moving fast enough (linear or
    /// angular) that a previously-settled die must re-detect and rebroadcast its face.
    #[must_use]
    pub fn is_knocked(&self, handle: RigidBodyHandle) -> bool {
        self.get_linear_speed(handle) > KNOCK_WAKE_LINEAR_SPEED
            || self.get_angular_speed(handle) > KNOCK_WAKE_ANGULAR_SPEED
    }

    /// Insert a pre-built rigid body and attach a collider to it.
    /// Returns the handle of the inserted body.
    pub fn spawn_body(&mut self, body: RigidBody, collider: Collider) -> RigidBodyHandle {
        let handle = self.rigid_body_set.insert(body);
        self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
        handle
    }

    /// Set linear velocity of a rigid body
    pub fn set_linear_velocity(&mut self, handle: RigidBodyHandle, vel: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_linvel(vector![vel[0], vel[1], vel[2]], true);
        }
    }

    /// Set angular velocity of a rigid body
    pub fn set_angular_velocity(&mut self, handle: RigidBodyHandle, vel: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_angvel(vector![vel[0], vel[1], vel[2]], true);
        }
    }

    /// Set the orientation of a rigid body from a quaternion `[x, y, z, w]`.
    pub fn set_rotation(&mut self, handle: RigidBodyHandle, quat: [f32; 4]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let q = nalgebra::UnitQuaternion::new_normalize(nalgebra::Quaternion::new(
                quat[3], quat[0], quat[1], quat[2],
            ));
            rb.set_rotation(q, true);
        }
    }

    /// Scale the current angular velocity of a rigid body by a factor (e.g. 0.75 to dampen)
    pub fn scale_angular_velocity(&mut self, handle: RigidBodyHandle, scale: f32) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let ang = *rb.angvel();
            rb.set_angvel(ang * scale, true);
        }
    }

    /// Apply a linear impulse expressed as a target Δv (U/s): scaled by the
    /// body's actual mass so every die type gains the same velocity — a hand
    /// imparts velocity, not impulse. For the d6 (mass = 1 M) this is
    /// bit-identical to a raw impulse of the same vector.
    pub fn apply_velocity_impulse(&mut self, handle: RigidBodyHandle, delta_v: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let m = rb.mass();
            rb.apply_impulse(vector![delta_v[0] * m, delta_v[1] * m, delta_v[2] * m], true);
        }
    }

    /// Apply a torque impulse to a rigid body
    pub fn apply_torque_impulse(&mut self, handle: RigidBodyHandle, torque: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.apply_torque_impulse(vector![torque[0], torque[1], torque[2]], true);
        }
    }

    /// Apply a spin impulse expressed as a target Δω (rad/s per axis): converted to
    /// a torque impulse using the body's actual angular inertia so every die type
    /// gains the same spin RATE — a hand imparts a spin rate, not a torque. The
    /// torque impulse is `I · Δω`, the inverse of Rapier's `Δω = I⁻¹ · L`; for the
    /// d6 (mass = 1 M) this is bit-identical to a raw torque impulse of `Δω / 6`.
    ///
    /// `I` is the **scalar mean of the body's principal moments of inertia**. Every
    /// Platonic die (d4/d6/d8/d12/d20) is an inertially isotropic top — all three
    /// principal moments are equal — so the mean is exact for them; only the d10
    /// (pentagonal trapezohedron) is mildly anisotropic, where the mean is a
    /// documented approximation. For the d6 (I = 1/6 M·U² on every axis) a target
    /// Δω is reproduced exactly, so [`ROLL_TORQUE_MAGNITUDE`]'s d6 roll is
    /// numerically unchanged from the previous raw-torque path.
    pub fn apply_spin_impulse(&mut self, handle: RigidBodyHandle, delta_omega: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let principal = rb.mass_properties().local_mprops.principal_inertia();
            let inertia = (principal.x + principal.y + principal.z) / 3.0;
            rb.apply_torque_impulse(
                vector![
                    delta_omega[0] * inertia,
                    delta_omega[1] * inertia,
                    delta_omega[2] * inertia
                ],
                true,
            );
        }
    }

    /// Clamp the linear speed of a body to `max_speed`. No-op if already within bounds.
    pub fn clamp_velocity(&mut self, handle: RigidBodyHandle, max_speed: f32) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let vel = *rb.linvel();
            let speed = vel.magnitude();
            if speed > max_speed {
                rb.set_linvel(vel * (max_speed / speed), true);
            }
        }
    }

    /// Move a body back into the arena and stop its current motion.
    pub fn reset_body_to_position(&mut self, handle: RigidBodyHandle, position: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_translation(vector![position[0], position[1], position[2]], true);
            rb.set_rotation(Rotation::identity(), true);
            rb.set_linvel(vector![0.0, 0.0, 0.0], true);
            rb.set_angvel(vector![0.0, 0.0, 0.0], true);
        }
    }

    /// Returns the number of rigid bodies currently in the simulation.
    #[must_use]
    pub fn body_count(&self) -> usize {
        self.rigid_body_set.len()
    }

    /// Remove a rigid body and all its attached colliders from the simulation.
    /// No-op if the handle is invalid (already removed or never inserted).
    pub fn remove_body(&mut self, handle: RigidBodyHandle) {
        self.rigid_body_set.remove(
            handle,
            &mut self.island_manager,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            true,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_physics_world_creation() {
        let world = PhysicsWorld::new();
        // Ground + ceiling + 4 walls = 6 fixed bodies
        assert_eq!(world.rigid_body_set.len(), 6);
    }

    #[test]
    fn arena_bounds_default_is_the_fixed_9_16_arena() {
        let b = ArenaBounds::default();
        assert_eq!(b.half_x, WALL_HALF_X);
        assert_eq!(b.half_z, WALL_HALF_Z);
    }

    #[test]
    fn from_aspect_9_16_is_exactly_the_default_arena() {
        // The canonical portrait aspect is a fixed point of the fit: it must
        // reproduce the default arena's half-extents bit-for-bit.
        let b = ArenaBounds::from_aspect(9.0 / 16.0);
        assert_eq!(b.half_x, 4.5, "9:16 must reproduce WALL_HALF_X exactly");
        assert_eq!(b.half_z, 8.0, "9:16 must reproduce WALL_HALF_Z exactly");
        assert_eq!(b, ArenaBounds::default());
    }

    #[test]
    fn from_aspect_preserves_playfield_area_and_tracks_aspect() {
        const AREA: f32 = WALL_HALF_X * WALL_HALF_Z;
        for aspect in [0.5_f32, 0.75, 1.0, 1.5, 2.0] {
            let b = ArenaBounds::from_aspect(aspect);
            assert!(
                (b.half_x * b.half_z - AREA).abs() < 1e-3,
                "area preserved for aspect {aspect}: got {}",
                b.half_x * b.half_z
            );
            // Wider windows widen X and shorten Z; the ratio equals the aspect.
            assert!(
                (b.half_x / b.half_z - aspect).abs() < 1e-3,
                "half_x/half_z tracks aspect for {aspect}"
            );
        }
    }

    #[test]
    fn from_aspect_clamps_extreme_windows() {
        // Below the clamp floor: pinned to aspect 0.4.
        assert_eq!(
            ArenaBounds::from_aspect(0.1),
            ArenaBounds::from_aspect(0.4),
            "aspect below 0.4 clamps to 0.4"
        );
        // Above the clamp ceiling: pinned to aspect 2.4.
        assert_eq!(
            ArenaBounds::from_aspect(10.0),
            ArenaBounds::from_aspect(2.4),
            "aspect above 2.4 clamps to 2.4"
        );
        // A degenerate (zero-height) viewport → +inf aspect → clamps, never NaN.
        let inf = ArenaBounds::from_aspect(f32::INFINITY);
        assert!(inf.half_x.is_finite() && inf.half_z.is_finite());
    }

    #[test]
    fn with_bounds_scales_arena_but_keeps_body_count() {
        // A custom arena still has ground + ceiling + 4 walls.
        let world = PhysicsWorld::with_bounds(ArenaBounds::from_aspect(1.0));
        assert_eq!(world.rigid_body_set.len(), 6);
    }

    #[test]
    fn test_physics_step_does_not_panic() {
        let mut world = PhysicsWorld::new();
        for _ in 0..60 {
            world.step();
        }
    }

    #[test]
    fn test_dice_falls_to_ground() {
        let mut world = PhysicsWorld::new();

        // Spawn a dynamic body above the ground
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, 5.0, 0.0])
            .build();
        let handle = world.rigid_body_set.insert(body);
        let collider = ColliderBuilder::cuboid(0.5, 0.5, 0.5)
            .restitution(DICE_RESTITUTION)
            .friction(DICE_FRICTION)
            .build();
        world.collider_set.insert_with_parent(collider, handle, &mut world.rigid_body_set);

        // Step for 2 seconds (120 ticks at 60Hz)
        for _ in 0..120 {
            world.step();
        }

        let pos = world.get_position(handle).unwrap();
        // Should have fallen near ground level (y ~= 0)
        assert!(pos[1] < 2.0, "Dice should have fallen, y={}", pos[1]);
        assert!(pos[1] > -1.0, "Dice should not fall through ground, y={}", pos[1]);
    }

    #[test]
    fn test_at_rest_detection() {
        let mut world = PhysicsWorld::new();

        let body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, 0.1, 0.0])
            .build();
        let handle = world.rigid_body_set.insert(body);
        let collider = ColliderBuilder::cuboid(0.5, 0.5, 0.5)
            .restitution(0.0) // No bounce for faster settling
            .friction(1.0)
            .build();
        world.collider_set.insert_with_parent(collider, handle, &mut world.rigid_body_set);

        // Step until settled (or timeout)
        for _ in 0..600 {
            world.step();
        }

        assert!(world.is_at_rest(handle), "Dice should be at rest after 10 seconds");
    }
}
