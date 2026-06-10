"use strict";

module.exports = function registerWorkspaceRoutes(app) {
  require("./thresholds")(app);
  require("./policies")(app);
  require("./workspaceReleases")(app);
  require("./integrations")(app);
  require("./github")(app);
  require("./intelligence")(app);
  require("./apiKeys")(app);
  require("./escalations")(app);
  require("./members")(app);
  require("./gate")(app);
};
