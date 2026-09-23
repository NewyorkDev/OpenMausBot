const { readFileSync } = require("node:fs");
const { parse } = require("yaml");

const base = parse(readFileSync(`${__dirname}/electron-builder.yml`, "utf8"));

// Build only the manual installer for the M4 host. A plain YAML `extends`
// merges target arrays and would also package the public Intel/ZIP targets.
module.exports = {
  ...base,
  mac: {
    ...base.mac,
    target: [{ target: "dmg", arch: ["arm64"] }],
    identity: "-",
  },
};
