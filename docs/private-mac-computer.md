# Select a paired Mac from the Windows workspace (0.1.90)

Install OpenMausBot 0.1.90 on both computers. Windows keeps your bots,
conversations, and DeepSeek key. The Mac shares its desktop as a named computer
in the Windows bot's Computer panel. The Mac does not need another DeepSeek key.
The desktop-control helper is bundled.

1. Install Tailscale on both computers and connect them to the same private
   tailnet. On Windows, with OpenMausBot running, run in PowerShell:

   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:8799
   ```

   Keep the HTTPS `.ts.net:8443` address it prints. Tailscale Serve restricts this
   endpoint to your tailnet; do not enable Funnel. Cloudflare is unnecessary.
2. In Windows OpenMausBot, open the bot's **Computer** panel or Settings →
   **Connected workspaces**, enable **Enable paired computers**, then restart
   the app. Return and click **Create Mac pairing code**.
3. On the Mac, launch the normal OpenMausBot app. Enable **Enable paired
   computers** in its local workspace and restart. In **Connected workspaces**,
   connect the Windows HTTPS address and enter the one-use pairing code when
   prompted. Use Connected workspaces; Desktop companion mode does not run the
   Mac desktop-control helper.
4. On the Mac, open **Computer access** for the Windows workspace. Select
   **Computer control**, click **Share selected access**, and approve the native
   confirmation. Folder and terminal grants are optional and not needed for
   desktop actions. Grant macOS **Accessibility** and **Screen Recording**
   permissions when requested; restart if macOS requires it.
5. On Windows, open the bot's **Computer** panel and select the Mac by name in
   the paired-computer list. Use a model that supports computer tools, such as
   the configured DeepSeek Flash model. Thinking remains a separate model
   setting; choose None when reasoning is unnecessary.

Keep both apps running and the Mac awake and signed in while using it. If the
Mac disconnects, the selected destination fails instead of using Windows.
Use **Stop sharing** on the Mac to revoke access. For ordinary conversation,
choose no computer destination; a greeting does not need desktop access.

The personal Mac installer is not notarized. If macOS blocks first launch,
use its Open Anyway option for this app under Privacy & Security. Install the
Apple silicon build on M-series Macs or the x64 build on Intel Macs.

Tailscale protects the device connection, but a cloud model still receives
prompts and relevant tool output, including screenshots requested by computer
calls. This configuration does not make DeepSeek's API local.

References: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
[Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve).
