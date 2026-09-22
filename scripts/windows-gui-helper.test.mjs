import { expect, it } from "vitest";
import { windowsGuiHelper } from "./windows-gui-helper.mjs";
it("stages a GUI derivative without modifying the upstream image or retaining its signature", () => {
  const source = Buffer.alloc(512);
  source.write("MZ"); source.writeUInt32LE(64, 0x3c); source.writeUInt32LE(0x4550, 64);
  source.writeUInt16LE(0x20b, 88); source.writeUInt16LE(3, 156);
  source.writeUInt32LE(400, 232); source.writeUInt32LE(32, 236);
  const result = windowsGuiHelper(source);
  expect(result.readUInt16LE(156)).toBe(2);
  expect(source.readUInt16LE(156)).toBe(3);
  expect(result.readUInt32LE(232)).toBe(0);
  expect(windowsGuiHelper(result)).toEqual(result);
  expect(() => windowsGuiHelper(Buffer.alloc(100))).toThrow();
});
