"use strict";

module.exports = function registerReleaseRoutes(app) {
  require("./signals")(app);
  require("./override")(app);
  require("./core")(app);
  require("./intelligence")(app);
  require("./sse")(app);
  require("./production")(app);
};
