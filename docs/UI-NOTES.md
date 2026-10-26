# UI notes (collected list)

Notes on the UI draft (https://claude.ai/artifact/DKwjHa7JYhiB8hRX2gPPXT).
They are collected and only worked through on request. Status: open · done · discarded

Implemented in 0.6.0: A1–A5, A7–A9 (plus house location, weather, real-time thunderstorms). A6 tasks implemented (recurring, people, wall terminal). Open: "Recently moved" for everyone or only your own.

## Open questions from the draft

- [x] Wall terminal in portrait or landscape? → both, configurable per terminal profile (see A1)
- [x] Wall terminal: also check in, or only search/take out? → check in too (see A3)
- [x] Introduce a planning permission per person? → yes (see A2)
- [x] View mode: 2D or 3D as default? → selectable per person (see A4)
- [x] Left sidebar in plan mode permanent, or drawer + right sidebar? → collapsible (see A5)
- [x] Overview: more cards? → tasks are missing (see A6)
- [ ] Overview: "Recently moved" for everyone or only your own?
- [x] Shopping list shared or per person? → one shared list is enough for now (stays as it is today)

## Notes

<!-- Format: - [ ] (area) note -->

- [x] **A1 (wall terminal)** Orientation configurable in the terminal's profile: **portrait** or **landscape**.
  The UI adapts: portrait = plan at the top, compartment contents below (as in the draft); landscape = plan on the
  left, compartment contents as a sidebar on the right, navigation still on the left. Add as a toggle for the wall
  terminal in the draft.

- [x] **A2 (permissions/planning)** Introduce a **"Plan" permission per person**. Without it, view only: the "Plan"
  button is locked, and house plan changes are rejected server-side too (`PUT /api/house` → 403). Configurable in
  people management (More → Administration) next to the existing role (`persons.role`: admin/user). **Admins may
  always do everything** (confirmed) – for them the checkbox is fixed and can't be unchecked. Existing people when this
  is introduced: keep the permission so nobody gets locked out.

- [x] **A3 (wall terminal)** Checking in is allowed on the terminal too (not just search/take out).
  As with taking out, the terminal asks via person tiles "Who is putting this in?" so the history is correct.
  Input via touch keyboard: large fields, suggestions from existing items, date as a picker instead of typing.

- [x] **A4 (house/view, settings)** Default view in view mode selectable **per person**: **2D** or **3D**.
  In More → Settings next to "Show when opening the app". Switching in the house remains possible at any time but
  doesn't change the default. Wall terminals: own setting in the terminal profile (together with A1).

- [x] **A5 (planning)** Left sidebar **collapsible** instead of permanent: catalog/furniture, floor and materials as a
  drawer that opens via a tool and collapses again. The right sidebar stays for the selection.

- [x] **A6 (overview, new: tasks)** The overview is missing **tasks**. New "Tasks" card with the household's open
  tasks. Needs a small task feature (create, complete, assigned to whom, due on; optionally attached to a
  room/furniture/compartment, e.g. "replace cooker hood filter" on KU, the kitchen). Clarify details before implementing.

- [x] **A7 (wall terminal, idle mode)** When not in use, the terminal shows a **large, dimmed house**, ideally
  **photorealistic** (path tracer), with **light by time of day** (sun position) and **local weather**
  (postal code in the settings; weather service without an API key, e.g. Open-Meteo). Tapping wakes the terminal
  into the house view. Re-render the image at intervals or pre-render it server-side so the iPad mini doesn't render
  permanently.

- [x] **A8 (phone, offline)** **Queue and resubmit** transactions on poor Wi-Fi (basement) instead of showing an
  error. Visible notice "3 transactions waiting", automatic resubmission, report conflicts (item gone in the meantime)
  clearly.

- [x] **A9 (settings)** **Font size and dark mode per person** configurable (More → Settings);
  wall terminals per device.
