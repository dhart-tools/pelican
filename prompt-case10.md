# Rerank judge — test harness #2 (pelican case 10, MoveDevices migration)

A harder, subtler test than case 05. Two reasons it's a good second probe:

1. **Change-awareness.** `sortMoveDevices` and `searchMoveDevices` were *noise* in case 05
   (a provisioning-saga change), but are *tester picks* here (a MoveDevices-component change).
   Same specs, opposite verdict — only a judge that reasons about THIS change gets it right.
2. **The name trap.** `badgesVersionChangeDeviceMoveBadger` and `moveSyncDevice` literally
   *move devices* (they call move commands), but the tester skipped them — their real subject
   is badge-version / sync-issue behaviour, with the move only a setup step. This is the fine
   line: "exercises the move-devices component" vs "uses moving as a step toward another assertion."

The change: `src/dm/components/MoveDevices/MoveDevices.tsx` migrated class → functional
(hooks). It's the Move Devices page — select source/target config zone, a **searchable +
sortable device table** (`setMoveDeviceSearchQuery`, `SelectDevicesTable`), the **move action**
(`moveDevicesToConfigZone`), and `useEffect` cleanup (`clearState` on unmount).

Ground truth (tester):
- `moveDevice` → **RELEVANT**
- `searchMoveDevices` → **RELEVANT**
- `sortMoveDevices` → **RELEVANT**  (was NOISE in case 05)
- `deleteDevices` → **NOISE**  (different action entirely)
- `badgesVersionChangeDeviceMoveBadger` → **NOISE**  (tester skipped; moves a device but tests badges — the trap)

---

## SYSTEM PROMPT

```
You decide whether a test should run for a given code change in a CI test-selection tool.
A test is RELEVANT only if it actually exercises the changed behaviour — i.e. a regression in
the change could make this test fail. A test that merely mentions the same feature/domain but
does not drive the changed code path is NOT relevant.
Respond with ONLY a JSON object: {"relevant": boolean, "confidence": number between 0 and 1, "why": short string}.
No prose, no code fences.
```

---

## CHANGE (shared by all cases)

`src/dm/components/MoveDevices/MoveDevices.tsx` — class → functional migration:

```tsx
const MoveDevices: FC<MoveDevicesProps> = ({
  selectedConfigZones, selectedDevices, configZoneMoveTo, configZones, devices,
  fetchConfigZones, getDevices, selectConfigZoneFrom, selectConfigZoneTo, selectDevice,
  clearState, moveDevicesToConfigZone, setMoveDeviceSearchQuery, searchQuery, ...
}) => {
  // mount: fetch zones + devices  (was componentDidMount)
  useEffect(() => {
    fetchConfigZones()
    if (selectedConfigZones.length) getDevices(selectedConfigZones)
  }, [fetchConfigZones, getDevices, selectedConfigZones])

  // unmount cleanup: clearState  (was componentWillUnmount)
  useEffect(() => () => clearState(), [clearState])

  // searchable + sortable device table
  const renderDevicesTable = useMemo(() => (
    <SelectDevicesTable
      selectedDevices={selectedDevices} devices={devices} selectDevice={selectDevice}
      setMoveDeviceSearchQuery={setMoveDeviceSearchQuery} searchQuery={searchQuery} />
  ), [selectedDevices, devices, selectDevice, setMoveDeviceSearchQuery, searchQuery])

  // source/target zone pickers + Move button → moveDevicesToConfigZone()
  // <MoveFromSelection .../> <MoveToSelection .../> <BDButton onClick={moveDevicesToConfigZone}/>
  // move-confirmation modals when devices selected and a target zone is chosen
}
```

Behaviour a migration bug could break: the move flow, search-within-move, sort-within-move,
the mount fetch, and the unmount `clearState` cleanup.

---

## CASE A — `moveDevice.cy.ts`  (RELEVANT)

```
CHANGE — src/dm/components/MoveDevices/MoveDevices.tsx
[the component above]

TEST — moveDevice.cy.ts
describe("Move device to another device group", () => {
  // Selects a source group, opens Move Devices, selects target zone, selects
  // devices, clicks Move, and asserts the device landed in the target group.
  cy.moveDevice(sourceGroup, targetGroup, device);
  // drives the move flow end to end (the component's moveDevicesToConfigZone path)
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE B — `sortMoveDevices.cy.ts`  (RELEVANT — was NOISE in case 05)

```
CHANGE — src/dm/components/MoveDevices/MoveDevices.tsx
[the component above]

TEST — sortMoveDevices.cy.ts
describe("Sort Move Devices", () => {
  // "system allows the user to sort the Serial Number, Device Type and Current
  // Device Group columns" — inside the Move Devices device table.
  // Opens Move Devices, clicks column headers, asserts sorted order in the
  // SelectDevicesTable rendered by the changed component.
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE C — `searchMoveDevices.cy.ts`  (RELEVANT)

```
CHANGE — src/dm/components/MoveDevices/MoveDevices.tsx
[the component above]

TEST — searchMoveDevices.cy.ts
describe("Search Move Devices", () => {
  // Opens Move Devices, types in the search box of the device table, asserts the
  // list filters — drives setMoveDeviceSearchQuery / searchQuery in the changed component.
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE D — `deleteDevices.cy.ts`  (NOISE — clean)

```
CHANGE — src/dm/components/MoveDevices/MoveDevices.tsx
[the component above]

TEST — deleteDevices.cy.ts
describe("Verify that system allows user to delete disconnected devices", () => {
  // Device DELETION workflow — only disconnected devices can be deleted, etc.
  // Imports/connects devices, then deletes them and asserts removal.
  // Does not open or use the Move Devices component.
  cy.searchItem(device);
  // ... delete actions, no move flow
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE E — `badgesVersionChangeDeviceMoveBadger.cy.ts`  (NOISE — the trap)

```
CHANGE — src/dm/components/MoveDevices/MoveDevices.tsx
[the component above]

TEST — badgesVersionChangeDeviceMoveBadger.cy.ts
describe("Badges – Device move with badge version update via user authentication", () => {
  // Subject: BADGE version changes when a device is moved between groups.
  // It DOES move a device, but via a higher-level command, and every assertion
  // is about badge version / authentication — not the move-devices UI itself.
  cy.moveDeviceFromDGAndPCUDashboardPage(sourceGroup, targetGroup, device);
  cy.connectDeviceUntilSuccess(device);
  // ... asserts badge version updated
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## Grading

| case | spec | ground truth | model said | correct? |
|------|------|--------------|-----------|----------|
| A | moveDevice | RELEVANT | ? | ? |
| B | sortMoveDevices | RELEVANT (noise in case 05!) | ? | ? |
| C | searchMoveDevices | RELEVANT | ? | ? |
| D | deleteDevices | NOISE | ? | ? |
| E | badgesVersionChangeDeviceMoveBadger | NOISE (trap) | ? | ? |

**Recall is non-negotiable: A, B, C must be `relevant:true`.** Drop any of them → recall break.

**Precision:** D should be `false` (clean). E is the honest hard one — it *does* move a device,
so a strict behavioural judge calling it `true` is defensible (a move-component regression
*could* surface there); the tester pruned it on risk. If the model keeps E, that's acceptable
noise, not a failure. If it drops D, great. If it drops E too, even better — but don't punish
keeping E.

Headline to watch: **B**. If the model says `relevant:true` for `sortMoveDevices` here, after
the same spec was correctly `false` in case 05, it's reasoning about the actual change — which
is the whole reason to use an LLM.
