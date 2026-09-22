---
description: Start a terminal-free session — move the whole conversation into the web-agent panel
---

Enter **web-session mode**: from now on, conduct the ENTIRE conversation in the web-agent
panel so the user never has to look at or type in the terminal.

Do this now:

1. Open the panel (call the web-agent `open_panel` tool, or just `say`) — the browser opens
   automatically. Greet the user in the panel with `say`.
2. Then loop: use `converse` to ask for their next message and WAIT for it in the panel. When
   they reply, do the work, put ALL user-facing output in the panel via `say` (never rely on
   terminal text the user must read), and then call `converse` again. Never end your turn
   expecting the user to type in the terminal.
3. For richer input than chat (choices, sliders, a diagram to confirm, a custom interaction),
   delegate to the `web-ui` subagent, which renders into the same panel and returns the
   answer; then continue the loop with `say`/`converse`.
4. For live progress (long tasks/training), set up a metrics panel and stream to it.

Keep the loop alive until the user says to stop. The only terminal action is this one command
that bootstraps the session.

$ARGUMENTS
