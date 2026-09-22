# Using a Mac privately as the bot's computer

Cloudflare is not required. Local Mac control works in host mode without a tunnel.
For access from Windows, use the existing Tailscale desktop companion connection.

1. Install a Mac build of OpenMausBot containing the desired engine changes,
   matching Apple silicon or Intel. A Windows installer cannot install on macOS;
   upstream Mac releases do not necessarily contain this personal branch's fixes.
2. Run the Mac app in normal **host mode**. The desktop-control helper is bundled.
3. Grant the app Accessibility and Screen Recording permissions when prompted
   (System Settings → Privacy & Security), then restart it if requested.
4. Configure DeepSeek on that Mac. Choose **DeepSeek V4.1 Flash**, enable its tool
   calls, and explicitly select **This computer**. Thinking can be None, Low,
   High or Max; provider Default is not automatic per-request reasoning selection.
5. To use that Mac-hosted workspace from Windows, install Tailscale on both,
   join the same tailnet, and follow [Pair over Tailscale](desktop-companion.md#pair-over-tailscale).
   The Mac is the host; Windows is the companion client. Keep the Mac awake.

Companion mode connects to the host's workspace. It does not add the client's
physical desktop as another destination to the existing host workspace. In
particular, installing the Mac as a client of Windows does not make that Mac
controllable: client mode does not start its local desktop-control daemon.
The existing VPS destination uses a separate remote Linux/Docker backend.

Tailscale encrypts device traffic end to end, including when relayed, but uses
coordination infrastructure. See [Tailscale security](https://tailscale.com/security).
Neither it nor removing Cloudflare makes a cloud model local: using DeepSeek's
API sends prompts and relevant tool output, including requested screenshots, to
DeepSeek. Keeping model inputs entirely on your own machines requires a local
model and a compatible, tested computer-control engine.
