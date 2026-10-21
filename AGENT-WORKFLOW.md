# Reel Studio: Codex-led editing

The target is the workflow demonstrated in the supplied 85-second video:

- 00:08–00:13: open Claude Code with a local working folder. Codex fills that role here.
- 00:13–00:18: give the agent FFmpeg, HyperFrames, and yt-dlp as tools.
- 00:18–00:37: provide raw footage and a reference; ask the agent to inspect the reference and apply the observed editing techniques.
- 00:37–00:51: request storyboard options before rendering to conserve time and tokens.
- 00:51–01:03: revise in conversation, then render an approved version.
- 01:03–01:18: save the approved look as a skill and a visual style menu for later videos.

The repository instruction is [.agents/skills/reel-editor/SKILL.md](.agents/skills/reel-editor/SKILL.md).

The browser is a tool surface around the ChatGPT/Codex conversation. The Site’s MCP connection exposes actual frame evidence, explicit edit commands, storyboard generation, approval-gated FFmpeg rendering, and approved style recipes. Install/connect the Site plugin once, then pair an open browser project using its generated prompt. Numerical measurements and the manual command parser are tools, not autonomous agents. No new local language model or separately billed model API is part of this workflow. See [BROWSER.md](BROWSER.md) for the connection steps and tool boundaries.
