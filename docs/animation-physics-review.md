# Model lecture animation review

Scope: all eight native model-lecture scenes. This is a review of the teaching
models, not a spring-strength, fatigue or finite-element certification.

| Scene | Model and review result | Verification |
| --- | --- | --- |
| Morph | Conceptual point-cloud interpolation, not a material undergoing physical deformation. End states represent different model concepts. | Existing light/dark browser coverage; new release visual recheck pending. |
| Miniature | Undamped harmonic motion retained under abstraction. Removing detail does not change the represented trajectory. | Factory review; view reconstruction now retains simulation time. |
| Law | Hanging, ideal massless linear spring with gravity, m=1 kg. Previously restarted its phase on k changes and redrew a normalized cosine as if it were a time trace. Now exact piecewise-constant-k dynamics preserve extension and velocity, shift equilibrium to mg/k, and draw actual history over eight seconds. | New numerical invariants and render-state regression tests. Browser acceptance pending. |
| Limits | Two descriptions of one fixed-k oscillator about its static equilibrium. Force opposes displacement; kinetic/potential energies exchange. Removed artificial nonzero minimum force and energy bars. | Zero-force, sign and energy-sum tests. |
| Runtime | Illustrative first-order actuator, not a motor torque/inertia model. Removed paused-frame target teleportation; response is frame-rate-independent and actual angle survives renderer reconstruction. | Pause/hold/reconstruction tests. |
| Learning | Genuine gradient descent on the displayed quadratic regression samples. Paused frames no longer consume queued training steps. | Loss reduction, step limit and pause tests. |
| Language | Schematic example probabilities, not an actual local transformer. Probabilities sum to one. Geometry now uses the same probability source as the controls; output stage no longer highlights input before token addition. | Probability normalization plus factory review. |
| Transfer | Conceptual workflow, not a physical simulation. Selecting stages changes emphasis, not scientific quantities. | Factory review; browser recheck pending. |

## Hanging spring assumptions

The coordinate is extension below the unstretched position, positive down:

- `m x'' = mg - kx`, equilibrium `x0 = mg/k`, angular frequency `sqrt(k/m)`.
- A change in k is external work: `ΔE = ½ Δk x²`. Position and velocity do not jump.
- Total energy for fixed k includes gravity: `½mv² + ½kx² - mgx`.
- No damping is claimed. A new equilibrium is not an instruction to teleport or
  settle the mass there; the mass continues oscillating about it.
- Wire diameter varies with the fourth root of stiffness for fixed shear modulus,
  mean coil diameter and active turn count. Rebuilding the helix preserves a
  circular wire cross-section instead of flattening it by axial mesh scaling.
- Wire/coil rendering is a schematic of an ideal massless, linear spring. It does
  not predict spring self-weight, coil contact, yielding, finite-extension changes
  in stiffness or manufacturing feasibility. Extreme repeated parameter pumping
  is outside the interpretation of a realistic physical spring. Do not describe
  this teaching model as an engineering-accurate material simulation.

References: [OpenStax: harmonic motion](https://openstax.org/books/university-physics-volume-1/pages/15-1-simple-harmonic-motion),
[OpenStax: energy](https://openstax.org/books/university-physics-volume-1/pages/15-2-energy-in-simple-harmonic-motion),
[RoyMech: helical springs](https://www.roymech.co.uk/Useful_Tables/Springs/Springs_helical.html).

Visible narrative captions are suppressed. Pause/resume and view reset use icons
with accessible names. Quantity and axis labels remain; removing them would make
the diagrams ambiguous. Numerical tests alone do not establish browser readiness.
