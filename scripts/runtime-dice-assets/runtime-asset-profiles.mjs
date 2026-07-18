export const DEFAULT_RUNTIME_ASSET_PROFILE = 'cozy-forest-v1'

export const RUNTIME_ASSET_PROFILES = Object.freeze({
  'cozy-forest-v1': Object.freeze({
    displayName: 'Cozy Forest',
    setId: 'cozy-forest-imagegen-set',
    proofPrefix: 'cozy-forest',
    sourceLockFile: 'cozy-forest-v1.lock.json',
    sourceLockSupplementFiles: Object.freeze(['cozy-forest-v1.metadata.lock.json']),
    dice: Object.freeze([
      Object.freeze({ diceId: 'acorn-compass-d10', diceType: 'd10', proofFace: 9, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'elder-canopy-d20', diceType: 'd20', proofFace: 20, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'fernlight-d8', diceType: 'd8', proofFace: 8, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'grovekeeper-d12', diceType: 'd12', proofFace: 12, scale: 1.25 }),
      Object.freeze({ diceId: 'hearthwood-d6', diceType: 'd6', proofFace: 6, scale: 1.1 }),
      Object.freeze({ diceId: 'mossheart-d4', diceType: 'd4', proofFace: 4, scale: 1.3888888888888888 }),
    ]),
  }),
  'cyberpunk-v1': Object.freeze({
    displayName: 'Cyberpunk',
    setId: 'cyberpunk-imagegen-set',
    proofPrefix: 'cyberpunk-box',
    sourceLockFile: 'cyberpunk-v1.lock.json',
    sourceLockSupplementFiles: Object.freeze([]),
    dice: Object.freeze([
      Object.freeze({ diceId: 'chrome-relay-d12', diceType: 'd12', proofFace: 12, scale: 1.25 }),
      Object.freeze({ diceId: 'cipher-core-d10', diceType: 'd10', proofFace: 9, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'neon-grid-d6', diceType: 'd6', proofFace: 6, scale: 1.1 }),
      Object.freeze({ diceId: 'overdrive-d20', diceType: 'd20', proofFace: 20, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'pulse-shard-d4', diceType: 'd4', proofFace: 4, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'volt-prism-d8', diceType: 'd8', proofFace: 8, scale: 1.3888888888888888 }),
    ]),
  }),
  'dark-dungeon-v1': Object.freeze({
    displayName: 'Dark Dungeon',
    setId: 'dark-dungeon-imagegen-set',
    proofPrefix: 'dark-dungeon',
    sourceLockFile: 'dark-dungeon-v1.lock.json',
    sourceLockSupplementFiles: Object.freeze([]),
    appearance: Object.freeze({
      baseColor: '#1a1a1a',
      accentColor: '#b91c1c',
      material: 'stone',
      roughness: 0.6,
      metalness: 0.1,
    }),
    dice: Object.freeze([
      Object.freeze({ diceId: 'cinder-spike-d4', diceType: 'd4', proofFace: 4, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'crypt-seal-d12', diceType: 'd12', proofFace: 12, scale: 1.25 }),
      Object.freeze({ diceId: 'dread-gate-d20', diceType: 'd20', proofFace: 20, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'gaoler-key-d10', diceType: 'd10', proofFace: 9, scale: 1.3888888888888888 }),
      Object.freeze({ diceId: 'iron-vault-d6', diceType: 'd6', proofFace: 6, scale: 1.1 }),
      Object.freeze({ diceId: 'obsidian-fang-d8', diceType: 'd8', proofFace: 8, scale: 1.3888888888888888 }),
    ]),
  }),
})

export function getRuntimeAssetProfile(profileId = DEFAULT_RUNTIME_ASSET_PROFILE) {
  const profile = RUNTIME_ASSET_PROFILES[profileId]
  if (!profile) {
    throw new Error(
      `Unknown runtime asset profile ${profileId}; expected one of ${Object.keys(RUNTIME_ASSET_PROFILES).join(', ')}`,
    )
  }
  return profile
}
