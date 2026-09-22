// The embedded SDK owns daemon spawning in native code. Mark the packaged
// helper as Windows GUI so Windows does not allocate a console for it.
// Keep the upstream cache untouched. The staged derivative is unsigned.
export function windowsGuiHelper(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Not a PE executable");
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 264 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 24) !== 0x20b) throw new Error("Expected PE32+ executable");
  const optional = pe + 24;
  const certificate = optional + 112 + 4 * 8;
  // Changing the subsystem invalidates Authenticode. Remove its directory
  // entry so the derivative never claims to retain the upstream signature.
  bytes.writeUInt32LE(0, certificate);
  bytes.writeUInt32LE(0, certificate + 4);
  const subsystem = bytes.readUInt16LE(optional + 68);
  if (![2, 3].includes(subsystem)) throw new Error("Unexpected PE subsystem");
  bytes.writeUInt16LE(2, optional + 68);
  bytes.writeUInt32LE(0, optional + 64); // Optional image checksum; loader computes it.
  return bytes;
}
