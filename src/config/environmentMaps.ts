/**
 * Self-hosted HDR environment maps (image-based lighting).
 *
 * These are the exact files drei's `<Environment preset="…">` used to fetch
 * from its asset CDN (`raw.githack.com/pmndrs/drei-assets@456060a/hdri/`) —
 * same bytes, same names, served from our own origin instead. Passing them as
 * `files={…}` takes the identical code path inside drei's `useEnvironment`:
 * a `.hdr` extension selects `RGBELoader`, and the resulting texture gets
 * `EquirectangularReflectionMapping` + `srgb-linear`, exactly as the preset
 * branch did. Lighting is unchanged; only the origin moved.
 *
 * Why self-host (issue #222):
 * - The CDN fetch was the last third-party runtime dependency on the solo path.
 *   Issue #227 made its failure survivable, but "survivable" still meant a
 *   ~30-38% dimmer metallic response for anyone the CDN could not reach.
 * - Offline is a first-class mode here (solo runs fully in-browser), and a
 *   third-party URL can never be precached by our service worker. Local files
 *   can, so an offline boot now gets full lighting instead of the downgrade.
 *
 * Licensing: both maps are by Greg Zaal, published on Poly Haven (formerly
 * HDRI Haven) under CC0 1.0 / public domain — "You do not need to give credit
 * or attribution when using them (although it is appreciated)". Redistribution
 * from our own origin, including commercially, is explicitly permitted. The
 * attribution above is voluntary.
 *
 * These files are precached by the service worker (`vite.config.ts` includes
 * `hdr` in `workbox.globPatterns`), so keep this directory small and deliberate
 * — every file added here lands in the install-time precache budget.
 */

/**
 * Table lighting for the main scene. Poly Haven "Dikhololo Night" (1k, 1.7 MB),
 * drei's `night` preset. Dim, cool, low-contrast outdoor night — chosen because
 * it flatters metallic dice bodies without washing out numeral contrast.
 */
export const TABLE_ENVIRONMENT_MAP_URL = '/textures/env/dikhololo_night_1k.hdr'

/**
 * Preview-stage lighting for the die inspector. Poly Haven "Potsdamer Platz"
 * (1k, 1.5 MB), drei's `city` preset. Brighter and more directional than the
 * table map, so a single inspected die reads with clear speculars.
 */
export const HERO_ENVIRONMENT_MAP_URL = '/textures/env/potsdamer_platz_1k.hdr'
