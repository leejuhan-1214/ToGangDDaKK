# LAND:15 design direction

The original 3D terrain, satellite imagery, camera controls and floating-panel
layout remain the core working surface. Historical imagery comparison is a
separate, explicitly opened view with a visible return action.

This redesign applies the audit in [Taste Skill's Redesign Skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md):

- SUIT variable type, readable Korean labels and tabular figures.
- Charcoal surfaces with one mint interaction accent. Scientific risk colours
  and the NASA NDVI legend retain their original data meaning.
- Quiet section dividers instead of repeated nested cards.
- Persistently named navigation tabs; mobile visual order follows DOM order.
- Clear hover, pressed, keyboard-focus and loading/error states.
- Cell-detail focus moves on a user action and returns on close. Automatic
  analysis updates never move keyboard focus.
- Existing 21st.dev Dock implementation and its licence are preserved.
- Compact layouts adapt spacing and reveal details on demand; primary controls
  fit without page scrolling at the tested viewport sizes.

No new framework or animation dependency was introduced. `design.css` is the
single theme and layout layer over the existing functional component styles.
SUIT and its SIL licence are in `vendor/fonts/`.
