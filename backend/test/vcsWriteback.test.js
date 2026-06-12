"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { verdiktStatusToGitHub, verdiktStatusToGitLab } = require("../src/services/vcsWriteback");

describe("vcsWriteback status mapping", () => {
  it("maps Verdikt statuses to GitHub commit states", () => {
    assert.deepEqual(verdiktStatusToGitHub("CERTIFIED"), {
      state: "success",
      description: "Release certified by Verdikt"
    });
    assert.equal(verdiktStatusToGitHub("UNCERTIFIED").state, "failure");
    assert.equal(verdiktStatusToGitHub("COLLECTING").state, "pending");
  });

  it("maps Verdikt statuses to GitLab pipeline states", () => {
    assert.equal(verdiktStatusToGitLab("CERTIFIED"), "success");
    assert.equal(verdiktStatusToGitLab("UNCERTIFIED"), "failed");
    assert.equal(verdiktStatusToGitLab("COLLECTING"), "running");
  });
});
