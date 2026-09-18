# LAND:15 design direction

LAND:15 opens on a globe, with real terrain and satellite imagery as the main
working surface. The observation console uses a compact header, a left rail for
analysis, a right rail for map tools, and a bottom strip for coordinates and
camera state. Analysis panels open on demand. Historical imagery comparison
remains a separate view with an explicit return action.

## References and original implementation

[OSIRIS](https://osirisai.live/) informed the full-screen globe composition,
vertical tool rails, dark surfaces and restrained coordinate/status displays.
[God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view) informed the
opt-in camera orbit and shareable view workflow. These are design references:
the console code, icons and LAND:15 branding were written for this project.
No reference project code, logo or assets were copied. The existing MapLibre
renderer and actual environmental data pipeline remain in place.

The earlier [Taste Skill redesign audit](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md)
continues to inform typography, clear interaction states and restrained panel
structure. The educational simulation retains its existing 21st.dev Dock
implementation and licence.

## Visual language and layout

- Near-black map surroundings and charcoal panels keep the imagery dominant.
  Muted gold marks actions and selection; cyan marks telemetry. Scientific
  classification colours and the NASA NDVI legend retain their data meaning.
- SUIT variable type supports Korean labels; tabular monospace figures make
  coordinates and camera values easy to scan. Source attribution remains visible.
- Section dividers replace repeated nested cards. A focus mode hides analysis
  surfaces while retaining map tools, telemetry and attribution.
- Desktop uses vertical analysis tabs. Narrow portrait screens use a bottom tab
  dock, and short landscape screens use a compact panel arrangement. The main
  workspace fits the viewport without page scrolling; details are revealed by
  their relevant panel or dialog. Tested sizes are recorded in [VALIDATION.md](VALIDATION.md).
- Pressed, selected, disabled, loading, error and keyboard-focus states are
  explicit. Tab navigation supports arrow keys, Home and End. Automatic data
  refresh does not move keyboard focus.

`console.css` is scoped to the observation console and layers over `live.css`.
`design.css` continues to style the separate educational simulation. No new
framework, icon package or animation dependency was introduced. SUIT and its
SIL licence remain in `vendor/fonts/`.

## Map interactions

Hand navigation is an explicitly started camera session, opened from the right
tool rail or H. Its compact panel explains the five hand shapes before permission
is requested and retains a camera-off action, status and mirrored preview.
Open palm translates the map; Victory changes bearing/pitch; thumbs adjust zoom;
a fist or missing hand stops movement. Tracking must settle before changing the
camera, and manual navigation temporarily takes ownership. Opening analysis or
measurement closes hand control so panels and input modes do not compete.

The pinned Google MediaPipe runtime/model is served from the same site and loaded
only after opt-in. Inference runs in a classic worker with one frame in flight.
Video and landmarks are neither recorded nor transmitted to a recognition server.
Stopping, closing, page hiding, errors and cancelled starts release camera tracks.
This input mode does not provide an environmental measurement or replace the
existing scientific data pipeline. Sources and licence are in
[vendor/mediapipe/SOURCES.md](vendor/mediapipe/SOURCES.md).

Search combines local landmarks, explicit latitude/longitude input and
[Photon](https://github.com/komoot/photon) / OpenStreetMap geocoding. Typing
filters local landmarks; submitting a place name sends the query to Photon.
Requests are spaced and stale requests are cancelled. Connection failures
leave local places and coordinate input usable. Results display their source.

Distance measurement consumes map clicks while active, so placing measurement
endpoints does not change the environmental analysis point. The line follows
a sampled great-circle arc and splits at the antimeridian. The displayed
distance is spherical surface distance between two coordinates, excluding
elevation, terrain relief and travel routes. Esc ends measurement.

Camera orbit starts only on request and preserves the current centre, zoom
and pitch. Direct map input, competing camera navigation, Esc or a hidden tab
stops it. It does not resume automatically and respects reduced-motion
preferences. Environmental queries are not repeatedly triggered by the
continuous camera animation.

The share action stores camera position, zoom, bearing and pitch together with
terrain, shading, official overlay, opacity, image-quality and low-light display
settings in the URL. It attempts to copy the URL; when clipboard access is
unavailable, the updated browser address can still be copied. It does not save
analysis results, measurement lines, an active orbit or a focused panel layout.

Search and shortcut help have explicit open/close controls. `/` or
`Ctrl/Command + K` opens search, 1–4 select analysis tabs, O toggles orbit,
F toggles full screen and R returns to the selected location. Typing in forms or
working in an open dialog suppresses the general map shortcuts.

## Keep display effects separate from evidence

The UTC clock shows the current clock time; the connection indicator reports
the actual query state. Neither means that the satellite imagery or scientific
datasets were observed at that time. The footer identifies the annual NASA
observations and the 2023 degradation status separately.

Low-light mode changes satellite-image brightness, saturation and contrast for
viewing comfort. It is not a night acquisition or thermal sensor. Sharpening
remains an optional bounded image-display operation. No cosmetic display mode
changes heights, scientific classifications or source values.

The terrain still comes from actual Mapterhorn elevations at height scale 1×,
with regional native levels selected where available. No arbitrary relief,
invented events, simulated sensor detections or synthetic scientific risk
scores were added to make the console appear active. Missing data and failed
requests remain explicit. The educational simulation is separate and labelled.
