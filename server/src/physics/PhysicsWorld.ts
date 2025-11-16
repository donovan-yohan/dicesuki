/**
 * Physics World Manager
 * Manages Rapier physics simulation for a game room
 */

import RAPIER from '@dimforge/rapier3d-compat'
import type { World, RigidBody, Collider } from '@dimforge/rapier3d-compat'
import type { DiceShape, DiceState, PhysicsConfig } from '../types/index.js'
import { DiceSimulator } from './DiceSimulator.js'

export class PhysicsWorld {
  private world: World | null = null
  private dice: Map<string, DiceSimulator> = new Map()
  private isInitialized = false
  private config: PhysicsConfig

  // Physics boundaries (walls and floor)
  private boundaries: Collider[] = []

  constructor(config: PhysicsConfig) {
    this.config = config
  }

  /**
   * Initialize Rapier physics world
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return

    // Initialize Rapier (async in Node.js)
    await RAPIER.init()

    // Create world with gravity
    const gravity = {
      x: this.config.gravity[0],
      y: this.config.gravity[1],
      z: this.config.gravity[2],
    }
    this.world = new RAPIER.World(gravity)

    // Create boundaries (floor and walls)
    this.createBoundaries()

    this.isInitialized = true
    console.log('Physics world initialized')
  }

  /**
   * Create floor and walls to contain dice
   */
  private createBoundaries(): void {
    if (!this.world) return

    // Floor (large static box)
    const floorSize = { x: 10, y: 0.5, z: 10 }
    const floorPos = { x: 0, y: -0.5, z: 0 }

    const floorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(floorPos.x, floorPos.y, floorPos.z)
    )

    const floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(floorSize.x / 2, floorSize.y / 2, floorSize.z / 2)
        .setRestitution(this.config.dice.restitution)
        .setFriction(this.config.dice.friction),
      floorBody
    )

    this.boundaries.push(floorCollider)

    // Walls (4 walls around the play area)
    const wallHeight = 5
    const wallThickness = 0.5
    const playAreaSize = 8

    const walls = [
      // Back wall (+Z)
      { x: 0, y: wallHeight / 2, z: playAreaSize / 2, sizeX: playAreaSize, sizeY: wallHeight, sizeZ: wallThickness },
      // Front wall (-Z)
      { x: 0, y: wallHeight / 2, z: -playAreaSize / 2, sizeX: playAreaSize, sizeY: wallHeight, sizeZ: wallThickness },
      // Right wall (+X)
      { x: playAreaSize / 2, y: wallHeight / 2, z: 0, sizeX: wallThickness, sizeY: wallHeight, sizeZ: playAreaSize },
      // Left wall (-X)
      { x: -playAreaSize / 2, y: wallHeight / 2, z: 0, sizeX: wallThickness, sizeY: wallHeight, sizeZ: playAreaSize },
    ]

    walls.forEach(wall => {
      const wallBody = this.world!.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(wall.x, wall.y, wall.z)
      )

      const wallCollider = this.world!.createCollider(
        RAPIER.ColliderDesc.cuboid(wall.sizeX / 2, wall.sizeY / 2, wall.sizeZ / 2)
          .setRestitution(this.config.dice.restitution)
          .setFriction(this.config.dice.friction),
        wallBody
      )

      this.boundaries.push(wallCollider)
    })
  }

  /**
   * Add a dice to the simulation
   */
  addDice(
    id: string,
    ownerId: string,
    type: DiceShape,
    position: [number, number, number],
    rotation: [number, number, number, number],
    color: string,
    rollGroupId?: string,
    rollGroupName?: string
  ): void {
    if (!this.world) {
      throw new Error('Physics world not initialized')
    }

    if (this.dice.has(id)) {
      console.warn(`Dice ${id} already exists in physics world`)
      return
    }

    const dice = new DiceSimulator(
      this.world,
      id,
      ownerId,
      type,
      position,
      rotation,
      color,
      this.config,
      rollGroupId,
      rollGroupName
    )

    this.dice.set(id, dice)
  }

  /**
   * Remove a dice from the simulation
   */
  removeDice(id: string): void {
    const dice = this.dice.get(id)
    if (!dice) {
      console.warn(`Dice ${id} not found in physics world`)
      return
    }

    dice.destroy()
    this.dice.delete(id)
  }

  /**
   * Apply impulse to a dice
   */
  applyImpulse(
    diceId: string,
    impulse: [number, number, number],
    torque?: [number, number, number]
  ): void {
    const dice = this.dice.get(diceId)
    if (!dice) {
      console.warn(`Dice ${diceId} not found`)
      return
    }

    dice.applyImpulse(impulse, torque)
  }

  /**
   * Update drag target for a dice
   */
  updateDrag(diceId: string, targetPosition: [number, number, number] | null): void {
    const dice = this.dice.get(diceId)
    if (!dice) {
      console.warn(`Dice ${diceId} not found`)
      return
    }

    dice.setDragTarget(targetPosition)
  }

  /**
   * Step the physics simulation forward
   */
  step(deltaTime: number): void {
    if (!this.world) return

    // Step the physics world
    this.world.step()

    // Update all dice
    this.dice.forEach(dice => {
      dice.update()
    })
  }

  /**
   * Get current state of all dice
   */
  getState(): DiceState[] {
    return Array.from(this.dice.values()).map(dice => dice.getState())
  }

  /**
   * Get state of a specific dice
   */
  getDiceState(id: string): DiceState | null {
    const dice = this.dice.get(id)
    return dice ? dice.getState() : null
  }

  /**
   * Get count of active dice
   */
  getDiceCount(): number {
    return this.dice.size
  }

  /**
   * Check if a dice exists
   */
  hasDice(id: string): boolean {
    return this.dice.has(id)
  }

  /**
   * Get dice owned by a specific player
   */
  getDiceByOwner(ownerId: string): DiceState[] {
    return Array.from(this.dice.values())
      .filter(dice => dice.getOwnerId() === ownerId)
      .map(dice => dice.getState())
  }

  /**
   * Destroy the physics world and clean up
   */
  destroy(): void {
    // Remove all dice
    this.dice.forEach(dice => dice.destroy())
    this.dice.clear()

    // Free the world
    if (this.world) {
      this.world.free()
      this.world = null
    }

    this.isInitialized = false
  }
}
