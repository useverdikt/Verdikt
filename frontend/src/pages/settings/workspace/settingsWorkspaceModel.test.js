import { describe, expect, it } from "vitest";
import {
  formatCsvRowCountLabel,
  hasConnectedSignalSource,
  isEvalSourceConnected,
  isReleaseTriggerReady,
  isThresholdsConfiguredFromApi
} from "./settingsWorkspaceModel.js";

describe("formatCsvRowCountLabel", () => {
  it("uses singular row for 1", () => {
    expect(formatCsvRowCountLabel(1)).toBe("1 row");
  });

  it("uses plural rows otherwise", () => {
    expect(formatCsvRowCountLabel(0)).toBe("0 rows");
    expect(formatCsvRowCountLabel(3)).toBe("3 rows");
  });
});

describe("isEvalSourceConnected", () => {
  it("is true for CSV import in use", () => {
    expect(
      isEvalSourceConnected([{ sourceType: "upload", status: "connected" }])
    ).toBe(true);
  });

  it("is true for any connected API integration", () => {
    expect(isEvalSourceConnected([{ sourceType: "api", status: "connected", name: "Sentry" }])).toBe(true);
  });

  it("is false when nothing is connected", () => {
    expect(
      isEvalSourceConnected([
        { sourceType: "upload", status: "not connected" },
        { sourceId: "sentry", status: "not connected" }
      ])
    ).toBe(false);
  });
});

describe("hasConnectedSignalSource", () => {
  it("is true for connected pull connector", () => {
    expect(hasConnectedSignalSource({ pull_connectors: [{ source_id: "sentry", connected: true }] })).toBe(true);
  });

  it("is true for active push source", () => {
    expect(hasConnectedSignalSource({ push_sources: [{ source_id: "custom", active: true, signal_count: 2 }] })).toBe(
      true
    );
  });

  it("is true for CSV import rows", () => {
    expect(hasConnectedSignalSource({ csv_import: { row_count: 3 } })).toBe(true);
  });

  it("falls back to legacy integrations array", () => {
    expect(hasConnectedSignalSource({ integrations: [{ source_id: "braintrust" }] })).toBe(true);
  });

  it("is false when nothing is connected", () => {
    expect(
      hasConnectedSignalSource({
        pull_connectors: [{ source_id: "sentry", connected: false }],
        push_sources: [{ source_id: "custom", active: false }]
      })
    ).toBe(false);
  });
});

describe("isThresholdsConfiguredFromApi", () => {
  it("is false for empty or missing map", () => {
    expect(isThresholdsConfiguredFromApi(null)).toBe(false);
    expect(isThresholdsConfiguredFromApi({})).toBe(false);
  });

  it("is true when API returns threshold rows", () => {
    expect(isThresholdsConfiguredFromApi({ accuracy: { min_value: 85, max_value: null } })).toBe(true);
  });
});

describe("isReleaseTriggerReady", () => {
  it("is true for manual trigger mode", () => {
    expect(isReleaseTriggerReady({}, { connected: false })).toBe(true);
  });

  it("requires GitHub repos when label trigger is active", () => {
    expect(
      isReleaseTriggerReady(
        { mode: "label" },
        { connected: true, selected_repo_count: 1 }
      )
    ).toBe(true);
    expect(
      isReleaseTriggerReady(
        { mode: "label" },
        { connected: true, selected_repo_count: 0 }
      )
    ).toBe(false);
  });
});
