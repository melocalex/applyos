import { createKnownAdapter } from "./helpers";
export const bambooHrAdapter = createKnownAdapter({
  id: "bamboohr",
  name: "BambooHR",
  hosts: ["bamboohr.com"],
  pathPattern: /\/(?:jobs|careers)(?:\/|$)/i
});
