import { describe, it, expect } from "vitest";
import {
  hmacSignatureChipLabel,
  signatureChipLabel,
  normalizeWorkspaceSlug,
  publicCertPermalinkPath,
  publicCertSlugPath,
  readConfiguredWorkspaceSlug
} from "./publicCertLinks.js";

describe("publicCertLinks", () => {
  it("normalizes workspace slugs", () => {
    expect(normalizeWorkspaceSlug(" Acme AI ")).toBe("acme-ai");
    expect(normalizeWorkspaceSlug("a--b")).toBe("a-b");
  });

  it("treats a missing localStorage slug as unconfigured", () => {
    const storage = { getItem: () => null };
    expect(readConfiguredWorkspaceSlug(storage)).toEqual({ slug: null, configured: false });
  });

  it("treats a stored slug as configured even when it is workspace", () => {
    const storage = { getItem: () => "workspace" };
    expect(readConfiguredWorkspaceSlug(storage)).toEqual({ slug: "workspace", configured: true });
  });

  it("builds a release-id permalink and a slug path", () => {
    expect(publicCertPermalinkPath("rel_abc")).toBe("/cert/id/rel_abc");
    expect(publicCertSlugPath("acme", "v1.0")).toBe("/cert/acme/v1.0");
    expect(publicCertPermalinkPath("")).toBe(null);
  });

  it("labels HMAC signatures without claiming third-party verifiability", () => {
    expect(hmacSignatureChipLabel("hmac-sha256")).toBe("signed · hmac-sha256");
    expect(signatureChipLabel("ed25519")).toBe("signed · ed25519 (publicly verifiable)");
    expect(signatureChipLabel("hmac-sha256")).toBe("signed · hmac-sha256");
  });
});
