# Motion Primitives Dock

The Dock distance interpolation, spring parameters, icon sizing and tooltip behavior
in `ui-controls.mjs` / `ui-controls.css` are adapted from Motion Primitives Dock.

21st.dev listing: https://21st.dev/@ibelick/components/dock

Original source: https://github.com/ibelick/motion-primitives/blob/main/components/core/dock.tsx

Original raw source: https://raw.githubusercontent.com/ibelick/motion-primitives/main/components/core/dock.tsx

License: https://github.com/ibelick/motion-primitives/blob/main/LICENCE.md

MIT License

Copyright (c) 2024 ibelick

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to
do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# Expandable Tabs behavior

Public reference: https://21st.dev/@victorwelander/components/expandable-tabs

Author: Victor Welander. The public listing identifies an MIT license, but the
registry download required authentication in this session. No authentication gate
was bypassed, and no gated source was obtained. Expandable label behavior in this
adapter is an original vanilla DOM implementation of its public visual behavior,
not a source-code port. The adapter does not claim to reproduce the original
React component's implementation.

# Integration and deviations

- Original Dock source and original license are archived next to this notice.
- Original pointer-distance interpolation is preserved: [-150, 0, 150] maps to
  [40, 80, 40] pixels, with configurable parameters.
- Original spring mass=0.1, stiffness=150 and damping=12 are preserved, using a
  numerical DOM animation loop instead of React / Motion runtime objects.
- Original icon width is half the animated item width; tooltip duration is 0.2 s.
- Compact screens cap magnification at 64 px. Small landscape screens, touch and reduced-motion use 40 px
  buttons without magnification, while keyboard labels remain accessible.
- Buttons and existing listeners are preserved. The adapter observes ARIA tab
  state, adds visual behaviors and does not control application panes or data.
