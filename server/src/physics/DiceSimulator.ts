/**
 * Dice Simulator
 * Manages physics for an individual dice instance
 */

import RAPIER from '@dimforge/rapier3d-compat'
import type { World, RigidBody, Collider } from '@dimforge/rapier3d-compat'
import type { DiceShape, DiceState, PhysicsConfig } from '../types/index.js'

export class DiceSimulator {
  private world: World
  private rigidBody: RigidBody
  private collider: Collider

  private id: string
  private ownerId: string
  private type: DiceShape
  private color: string
  private config: PhysicsConfig

  // Rest detection
  private restStartTime: number | null = null
  private isAtRest: boolean = false
  private faceValue: number | null = null

  // Drag state
  private dragTarget: [number, number, number] | null = null
  private readonly DRAG_FOLLOW_SPEED = 12
  private readonly DRAG_PLANE_HEIGHT = 2

  constructor(
    world: World,
    id: string,
    ownerId: string,
    type: DiceShape,
    position: [number, number, number],
    rotation: [number, number, number, number], // Quaternion [x, y, z, w]
    color: string,
    config: PhysicsConfig
  ) {
    this.world = world
    this.id = id
    this.ownerId = ownerId
    this.type = type
    this.color = color
    this.config = config

    // Create rigid body
    this.rigidBody = this.createRigidBody(position, rotation)

    // Create collider based on dice type
    this.collider = this.createCollider()
  }

  /**
   * Create rigid body for dice
   */
  private createRigidBody(
    position: [number, number, number],
    rotation: [number, number, number, number]
  ): RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] })
      .setCanSleep(false) // Never sleep - always simulate

    return this.world.createRigidBody(bodyDesc)
  }

  /**
   * Create collider based on dice type
   */
  private createCollider(): Collider {
    let colliderDesc: RAPIER.ColliderDesc

    switch (this.type) {
      case 'd6':
        // Cube with rounded edges
        colliderDesc = RAPIER.ColliderDesc.roundCuboid(0.4, 0.4, 0.4, 0.08)
        break

      case 'd4':
      case 'd8':
      case 'd10':
      case 'd12':
      case 'd20':
        // Convex hull approximation (simplified - use sphere for now)
        // TODO: Generate actual convex hulls from geometry vertices
        colliderDesc = RAPIER.ColliderDesc.ball(0.5)
        break

      default:
        colliderDesc = RAPIER.ColliderDesc.ball(0.5)
    }

    colliderDesc
      .setRestitution(this.config.dice.restitution)
      .setFriction(this.config.dice.friction)
      .setDensity(1.0)

    return this.world.createCollider(colliderDesc, this.rigidBody)
  }

  /**
   * Apply impulse to the dice
   */
  applyImpulse(
    impulse: [number, number, number],
    torque?: [number, number, number]
  ): void {
    this.rigidBody.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true)

    if (torque) {
      this.rigidBody.applyTorqueImpulse(
        { x: torque[0], y: torque[1], z: torque[2] },
        true
      )
    }

    // Reset rest state
    this.isAtRest = false
    this.restStartTime = null
    this.faceValue = null
  }

  /**
   * Set drag target position
   */
  setDragTarget(target: [number, number, number] | null): void {
    this.dragTarget = target

    if (target) {
      // Wake up dice when dragging starts
      this.rigidBody.wakeUp()
      this.isAtRest = false
      this.restStartTime = null
    }
  }

  /**
   * Update dice state (called every physics tick)
   */
  update(): void {
    // Handle drag
    if (this.dragTarget) {
      this.applyDragForce()
    }

    // Check if dice is at rest
    this.checkRestState()

    // Clamp velocity to prevent wall clipping
    this.clampVelocity()
  }

  /**
   * Apply drag force to follow target position
   */
  private applyDragForce(): void {
    if (!this.dragTarget) return

    const currentPos = this.rigidBody.translation()
    const targetPos = this.dragTarget

    // Calculate displacement
    const displacement = {
      x: targetPos[0] - currentPos.x,
      y: targetPos[1] - currentPos.y,
      z: targetPos[2] - currentPos.z,
    }

    // Apply velocity towards target
    const desiredVelocity = {
      x: displacement.x * this.DRAG_FOLLOW_SPEED,
      y: displacement.y * this.DRAG_FOLLOW_SPEED,
      z: displacement.z * this.DRAG_FOLLOW_SPEED,
    }

    this.rigidBody.setLinvel(desiredVelocity, true)
  }

  /**
   * Check if dice is at rest
   */
  private checkRestState(): void {
    const linvel = this.rigidBody.linvel()
    const angvel = this.rigidBody.angvel()

    const linearSpeed = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2)
    const angularSpeed = Math.sqrt(angvel.x ** 2 + angvel.y ** 2 + angvel.z ** 2)

    const isStopped =
      linearSpeed < this.config.rest.linearVelocityThreshold &&
      angularSpeed < this.config.rest.angularVelocityThreshold

    if (isStopped) {
      if (this.restStartTime === null) {
        this.restStartTime = Date.now()
      } else if (!this.isAtRest) {
        const restDuration = Date.now() - this.restStartTime
        if (restDuration >= this.config.rest.durationMs) {
          this.isAtRest = true
          this.detectFaceValue()
        }
      }
    } else {
      this.restStartTime = null
      this.isAtRest = false
      this.faceValue = null
    }
  }

  /**
   * Detect which face is pointing up
   * TODO: Implement proper face detection based on dice geometry
   */
  private detectFaceValue(): void {
    const rotation = this.rigidBody.rotation()

    // Simplified face detection (placeholder)
    // In a real implementation, this would analyze the rotation quaternion
    // to determine which face is pointing up based on the dice type

    switch (this.type) {
      case 'd4':
        this.faceValue = Math.floor(Math.random() * 4) + 1
        break
      case 'd6':
        this.faceValue = Math.floor(Math.random() * 6) + 1
        break
      case 'd8':
        this.faceValue = Math.floor(Math.random() * 8) + 1
        break
      case 'd10':
        this.faceValue = Math.floor(Math.random() * 10) + 1
        break
      case 'd12':
        this.faceValue = Math.floor(Math.random() * 12) + 1
        break
      case 'd20':
        this.faceValue = Math.floor(Math.random() * 20) + 1
        break
    }
  }

  /**
   * Clamp velocity to prevent wall clipping
   */
  private clampVelocity(): void {
    const linvel = this.rigidBody.linvel()
    const speed = Math.sqrt(linvel.x ** 2 + linvel.y ** 2 + linvel.z ** 2)

    if (speed > this.config.maxDiceVelocity) {
      const scale = this.config.maxDiceVelocity / speed
      this.rigidBody.setLinvel(
        { x: linvel.x * scale, y: linvel.y * scale, z: linvel.z * scale },
        true
      )
    }
  }

  /**
   * Get current state of the dice
   */
  getState(): DiceState {
    const translation = this.rigidBody.translation()
    const rotation = this.rigidBody.rotation()
    const linvel = this.rigidBody.linvel()
    const angvel = this.rigidBody.angvel()

    return {
      id: this.id,
      ownerId: this.ownerId,
      type: this.type,
      position: [translation.x, translation.y, translation.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      linearVelocity: [linvel.x, linvel.y, linvel.z],
      angularVelocity: [angvel.x, angvel.y, angvel.z],
      isAtRest: this.isAtRest,
      faceValue: this.faceValue,
    }
  }

  /**
   * Get owner ID
   */
  getOwnerId(): string {
    return this.ownerId
  }

  /**
   * Destroy the dice and free resources
   */
  destroy(): void {
    this.world.removeCollider(this.collider, false)
    this.world.removeRigidBody(this.rigidBody)
  }
}
