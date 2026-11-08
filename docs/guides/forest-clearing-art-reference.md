# Forest Clearing Art Reference

> Historical art-reference and prototype checkpoint. Its earlier full-suite failure and ignored local evidence paths are retained as history, not current release status. See [Themed Dice Worlds](../exec-plans/active/themed-dice-worlds.md) and the current PR for final integration gates. Referenced user images and ignored captures are not bundled public evidence.

## Direction

A living fantasy clearing surrounded by a tree line, not an exposed-soil lawn inside a wooden tray. Sparse tall grass reveals matching moss and short-grass texture, not brown dirt. Use restrained sage, moss and cooler forest greens; cream flowers and a few pale dandelion heads provide small value accents. Do not solve lushness by filling every cell or increasing mobile grass budgets.

The user's attached Genshin screenshot is the primary visual reference. It shows layered leafy ground coverage with white flower accents. Its screen-space lighting is not a literal material color palette. The user's explicit preference for less saturated greens takes precedence over reproducing its brightest pixels.

### Overhead canopy correction

The later overhead reference (`upload_fdna1l2a.png`) changes the framing target.
The camera should look through an irregular canopy opening, not at a continuous
ring of waist-high shrubs. Large layered leaf silhouettes peek into the frame,
with darker foliage outside and directional cast shadows reaching onto the
clearing. Keep a broad readable center for dice. The reference's dirt path,
pond, props and painterly gradients are not requests to copy those features;
retain the lush green ground and adapt the composition to cel-lit shapes.

Use canopy geometry as actual shadow casters. Keep cloud shade as a restrained,
slow-moving direct-light modulation on ground/grass, not opaque clouds or a
screen-space color wash covering dice. Reuse ambient time so reduced motion
freezes it. Keep canopy, cloud shade and particle motion out of grass-only
causal comparisons. A shrub-only cel version is not this framing correction.

## Studied references

- [Wind Waker texture and technical analysis, original discussion](https://polycount.com/discussion/104415/zelda-wind-waker-tech-and-texture-analysis-picture-heavy/p1). The texture overview shows compact painted shape families and restrained detail. Study the relationship of the surface texture and geometry; do not copy Nintendo textures.
- [Wind Waker vegetation analysis, Warby and Simon Trümpler](https://simonschreibt.de/gat/zelda-wind-waker-hyrule-travel-guide/#vegetation). This reverse-engineered account observes separate plant draws. It is not a prescription to copy that draw-call model in WebGL.
- [Genshin Mondstadt flora screenshots](https://www.powerpyx.com/genshin-impact-flighty-flora-and-flora-walkthrough/). Small, distinctive flowers and seed heads sit in the same palette and lighting as the grass. They form local accents near vegetation rather than a uniform confetti layer.
- [Breath of the Wild grass screenshot discussion](https://forums.unrealengine.com/t/botw-grass-style/437647). The screenshots show warm highlights, cool green shade and small pale flowers within grass masses. Comments about Nintendo's exact shader implementation are speculation, not source evidence.

## Applied choices

- Original opaque blade albedo with a subdued rib, soft edge variation and mipmaps; retain geometric silhouettes and wind/contact deformation.
- Original repeatable short-grass brush-mark texture, combined with broad seeded color variation and restrained root occlusion.
- Match the two grass layers with the theme palette instead of making bare ground a contrasting material.
- Frame the edge with irregular bark trunks/root flares and leaf-shaped shrubs, not faceted green balls or a four-sided row of identical plants.
- Put a bounded collection of small cream daisies, yellow blooms and pale seed heads in uneven groups; maintain dice readability.
- No new real-time lights, volumetric pass, grass collisions, renderer registry or per-plant React components.

## Integrated local candidate

The scene now uses three merged opaque Lambert batches instead of four plank
meshes: forked trunks/root flares, cupped broadleaf sprays and wildflowers.
The high-tier actual four-dice scene contains 27 daisies, 27 pale seed heads
and 26 yellow blooms. The three batches total 8,338 triangles in that actual
arena. Roots and leaf overhang stay in bounded edge bands and do not introduce
physics or pick targets. The helper shares the existing ambient animation clock.

Original blade/ground albedo maps are mipmapped, opaque and theme-tinted. The
ground is green even where tall grass is sparse; no earth-colored clearing
material remains. Current actual renderer evidence is under the ignored
woodland `forest-clearing/` directory, including a four-die screenshot, all-tier
views, an isolated grass-motion receipt and WebGL1 rendering. The final production
build and authoring-boundary checks passed. A smoke of the actual built bundle
spawned and rolled four guest dice with nonzero WebGL work, no lost context and
zero GL/page/console errors (`production-smoke.json`, `production-scene.png`).
The disposable browser and production-preview server were closed afterward.
All three woodland browser integration tests also passed with process exit zero,
covering allocated shadow targets, reduced motion and real-roll grass recovery.

## Limits

The integrated delta passed independent static review with no blocking
correctness or security findings. Flower shader sway uses static normals and
can extend approximately 0.046 world units beyond its undeformed culling
bounds. These are recorded minor approximations, not demonstrated visible
failures or fixes. The final full suite has no passing receipt: its fork runner
stalled without output and was terminated, and alternate Node/threads probes
also encountered runner-start or teardown stalls. Browser tests and production
build passed, but they do not substitute for that missing full-suite gate.

The image-generation provider returned a model-not-found 404. The texture implementation is explicitly original generated brushwork, not image-generated artwork. Physical-mobile frame pacing, thermal behavior and the common off-CPU desktop stalls are separate unresolved acceptance items.
