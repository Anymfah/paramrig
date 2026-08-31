# UI study scope and assumptions

Approved scope: three desktop mockups, not a working application. The founder
chose the restrained branding direction and asked for library, SVG and 3D views.

- Audience: a developer or vibecoder whose agent prepared a purpose-built rig.
- Library action: find and open a rig discovered in the current project.
- Editor action: refine the visual result; export the accepted parameter set.
- Prior knowledge: the user knows what they asked their agent to build but may
  not know which numeric settings produce the result they can picture.
- Message: AI builds the tools; the human shapes the result.
- Default: the renderer owns the large center region, shared chrome provides
  navigation, inspector and optional timeline. Custom controls stay possible.
- Recovery proposal: snapshot comparison and resetting changed parameters;
  exports should not overwrite source automatically. These are not implemented.
- Data: four explicit sample rigs. Empty-library and large-library behavior are
  not depicted; future implementation should explain file discovery in an empty
  state and support scoped search and grouped navigation at larger counts.
- Mobile: not included in this desktop study. A later design should show the
  inspector as a separate dock or sheet rather than shrinking three columns.
- Long content: source paths and arbitrary control labels need wrapping or a
  readable detail view in implementation; fixed-size mockups show sample content.
- Failure states: future local-runner errors should preserve tuned values and
  identify the failing rig; cloud availability must not gate local editing.
- Color: dark chrome for focused editing; colored procedural content may live
  inside the preview without becoming a brand accent.

No controls, routes, runtime performance, accessibility behavior or integrations
are claimed to work on the basis of these static exports.
