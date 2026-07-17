# Three-theme ImageGen workshop

This directory contains geometry-derived numbered edit targets for D4, D6, D8, D10, D12, and D20. The JSON manifest is the source of truth for face value, triangle grouping, UV coordinates, and numeral baseline orientation.

- The numbered PNG is the Codex ImageGen edit target.
- The guide PNG highlights the canonical baseline edge in orange.
- Generated art must preserve one face value per island and the recorded rotation.
- D10 has ten kite islands. Each kite maps two consecutive mesh triangles to one physical face and one value.
- Runtime normal maps are derived from the final ImageGen albedo atlas, so raised trim and engraved or embossed numeral contrast affect lighting without changing face-reading geometry.
