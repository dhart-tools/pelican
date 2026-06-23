# Rerank judge — hard-case test harness (pelican case 05)

This is the **tricky cluster** that no static signal can separate: three specs that
all match the changed file on the same token (`provisioning`), the same route
(`/managedevices`), and the same selectors (`ZoneProvisioningStatus_…`). Filenames,
routes, selectors — identical. The ONLY thing that separates them is **what each test
actually does**.

Ground truth (from the tester):
- `startProvisioningFromPCUDashboard.cy.ts` → **RELEVANT** (tester picked it)
- `provisioningStatusPopover.cy.ts` → **NOISE** (tester did NOT pick it)
- `provisioningDecommissioning.cy.ts` → **NOISE** (tester did NOT pick it)

The change is to `src/dm/sagas/provisioning.ts` — the saga that handles START/STOP
provisioning sessions (`startProvisioning`, `startProvisioningSuccess`, `stopProvisioning`,
`stopProvisioningSuccess`, and their failure handlers).

**How to test:** paste the SYSTEM PROMPT + one CASE block (CHANGE + TEST) into a model,
collect the JSON, repeat for all three. A good judge returns `relevant:true` for case A
and `relevant:false` for B and C. Score it against the ground truth above.

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

## CHANGE (shared by all three cases)

`src/dm/sagas/provisioning.ts` — redux-saga handling start/stop provisioning sessions:

```ts
import { all, delay, takeEvery, call, put, take, select } from 'redux-saga/effects'
import { ProvisioningActions } from '@dm/constants'
import { fetchItems, toggleStopProvisioningModal, clearSelectedConfigZones, toggleStartProvisioningWizard } from '@dm/actions/manageDevices'
import { ProvisioningService } from '@dm/api/ProvisioningService'
import { toggleStartProvisioningBtn } from '../actions/provisioning'

export function* startProvisioning(action) {
  yield put(toggleStartProvisioningBtn())
  try {
    const saveData = action.payload.zones.map(zone => ({
      configZoneKey: zone.configZoneId,
      sessionPlannedEndDateTime: action.payload.endDateTime,
      devices: null
    }))
    yield call(ProvisioningService.startProvisioning, saveData)
  } catch (error) {
    yield put(GeneralAPIError(error))
  }
}

export function* startProvisioningSuccess(action) {
  // builds a success alert, closes the start-provisioning wizard, re-fetches
  // the device list, clears the selected config zones.
  yield put(showAlert({ type: AlertTypes.success, alertText: i18n.t('manageDevices:manageDevices.provisioning.startingSuccess'), ... }))
  yield delay(100)
  yield put(toggleStartProvisioningBtn())
  yield put(toggleStartProvisioningWizard({ shouldClose: true }))
  yield put(preventPageLeaving(false))
  yield put(fetchItems({ ... }))
  yield put(clearSelectedConfigZones())
}

export function* startProvisioningFailure() {
  yield put(toggleStartProvisioningBtn())
  yield put(toggleStartProvisioningWizard({ shouldClose: true }))
  yield put(fetchItems({ loadDeviceGroupDevices: false }))
  yield put(showAlert({ type: AlertTypes.danger, alertText: i18n.t('manageDevices:manageDevices.provisioning.startingFailure') }))
}

export function* stopProvisioning() {
  // resolves the provisioning session key, calls ProvisioningService.stopProvisioning
  ...
}
export function* stopProvisioningSuccess(action) {
  // re-fetches items, closes the stop-provisioning modal, success alert
  ...
}
export function* stopProvisioningFailure() {
  // re-fetches, closes modal, danger alert
  ...
}

export function* Provisioning() {
  yield all([
    takeEvery(ProvisioningActions.START_PROVISIONING, startProvisioning),
    takeEvery(ProvisioningActions.START_PROVISIONING_SUCCESS, startProvisioningSuccess),
    takeEvery(ProvisioningActions.START_PROVISIONING_FAILURE, startProvisioningFailure),
    takeEvery(ProvisioningActions.STOP_PROVISIONING, stopProvisioning),
    takeEvery(ProvisioningActions.STOP_PROVISIONING_SUCCESS, stopProvisioningSuccess),
    takeEvery(ProvisioningActions.STOP_PROVISIONING_FAILURE, stopProvisioningFailure)
  ])
}
```

---

## CASE A — `startProvisioningFromPCUDashboard.cy.ts`  (ground truth: RELEVANT)

USER MESSAGE:

```
CHANGE — src/dm/sagas/provisioning.ts
[the saga above]

TEST — cypress/e2e/.../startProvisioningFromPCUDashboard.cy.ts
describe("Start Provisioning Session", () => {
  // Verifies the system lets a user START a provisioning session for one or more
  // device groups, and that the provisioned value updates afterward.

  // The test actively STARTS provisioning (this dispatches START_PROVISIONING,
  // which the changed saga handles):
  cy.startProvisioningFromPCU(deviceGroupName);

  // Cancel-flow scenario — opens the Start Provisioning wizard and cancels it:
  cy.get(dataTestIds.actionsButton).click();
  cy.get(dataTestIds.startButton).click();
  cy.get(dataTestIds.startProvisioningList).should("be.visible");
  cy.get(dataTestIds.startProvisionEndDate).eq(1).clear();
  cy.get(dataTestIds.saveButton).should("be.disabled");
  cy.get(dataTestIds.startProvisioningCrossIcon).click();
  cy.confirmModal("approve");

  // "ProvisionedStatusUpdated" scenario — start, connect device, assert it becomes provisioned:
  cy.startProvisioningFromPCU(deviceGroupName);
  cy.connectDeviceUntilSuccess(connectedDevice);
  cy.assertProvisioningStatus(connectedDevice, 'Yes');
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE B — `provisioningStatusPopover.cy.ts`  (ground truth: NOISE)

USER MESSAGE:

```
CHANGE — src/dm/sagas/provisioning.ts
[the saga above]

TEST — cypress/e2e/.../provisioningStatusPopover.cy.ts
describe("Verify Provisioning Status/Popover details in Provisioning Status column", () => {
  // Verifies that the provisioning-status COLUMN and POPOVER display the right
  // group type, group name, description, start/end date and username.
  // It provisions a device in `before()` ONLY as setup, then asserts DISPLAY:

  cy.navigateToPage("/managedevices");

  // ProvisionStatusActive: assert the status indicator is visible and green:
  cy.get(`[data-test-id='ZoneProvisioningStatus_${deviceGroupName}']`).should("be.visible");
  cy.get(`[data-test-id*='ZoneProvisioningStatus_${deviceGroupName}'] >i`)
    .should("have.css", "color", greenIndicator);
  cy.get(`[data-test-id*='ZoneProvisioningStatus_${deviceGroupName}']`).click();
  cy.get(dataTestIds.pcuIndicatorOnPopover).should("be.visible");

  // ProvisionStatusPopover: open the popover, assert description / group name / type / username text:
  cy.get(dataTestIds.zoneProvisioningPopover).trigger("mouseover");
  cy.get(dataTestIds.zoneProvisioningDescriptionPopover).invoke("text").then(...);
  cy.get(`h3[title='${deviceGroupName}']`).should("have.text", deviceGroupName);
  cy.get(`[data-test-id='ConfigZoneName_${deviceGroupName}_startedBy']`).should("have.text", `By ${userName}`);
  // No START or STOP provisioning is dispatched in the test bodies; provisioning
  // happens once in setup via cy.deviceProvisioning(...).
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## CASE C — `provisioningDecommissioning.cy.ts`  (ground truth: NOISE)

USER MESSAGE:

```
CHANGE — src/dm/sagas/provisioning.ts
[the saga above]

TEST — cypress/e2e/.../provisioningDecommissioning.cy.ts
describe("Provision Decommissioned a device", () => {
  // Verifies a device shows "Provisioning Decommissioned" status after a
  // decommission EVENT arrives. Provisioning is done once in before() as setup
  // (cy.deviceProvisioning) via deploy + connect; the test bodies drive a
  // mocktale device EVENT and assert status text — they do not start/stop a
  // provisioning session through the app UI/actions.

  cy.fixture("legacy/provisionDecommission.json").then((data) => {
    data.messageData.EventHeader.SendingDeviceId.SerialNumber = device;
    cy.messageSender(device, data);          // sends a decommission event via API
  });
  assertProvisioningMessage(deviceGroup.name, device, provisioningStatus[1], provisioningMessage);
}

Does this test exercise the changed behaviour? Reply with the JSON object only.
```

---

## Grading

| case | spec | ground truth | model said | correct? |
|------|------|--------------|-----------|----------|
| A | startProvisioningFromPCUDashboard | RELEVANT | ? | ? |
| B | provisioningStatusPopover | NOISE | ? | ? |
| C | provisioningDecommissioning | NOISE | ? | ? |

A model that nails this returns **A=true, B=false, C=false**. If a model keeps all
three (A=B=C=true), it adds no precision over static analysis. If it drops A, it breaks
recall — disqualified.

The genuinely hard call is **B**: it clicks the provisioning status and opens the popover,
which *visually* looks provisioning-related, but it never starts/stops a session, so a change
to the start/stop saga can't break it. That's the line we're asking the model to draw.
