"use strict";

module.exports = function registerRoutes(app) {
  require("./health")(app);
  require("./webhooks")(app);
  require("./auth")(app);
  require("./workspaces")(app);
  require("./releases")(app);
};
