import { spawn } from "node:child_process";

/** Captured subprocess output can contain credentials; never pass them on to logs or reports. */
export function redact(text: string): string {
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(name) && value && value.length >= 8) text = text.split(value).join("[redacted]");
  }
  return text;
}

/** No shell, bounded output and a deadline that also terminates descendant processes. */
export function runCommand(command: string, args: string[], cwd: string, input?: string, timeoutMs = 30_000): Promise<string> {
  const keep = new Set(["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "CODEX_HOME", "CODEX_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.has(name) || name.startsWith("GIT_")));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", failure = "";
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (why: string) => {
      if (failure) return;
      failure = why;
      try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch {}
      killTimer = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} }, 2000);
      killTimer.unref();
    };
    const timer = setTimeout(() => stop(`${command} timed out after ${timeoutMs / 1000}s`), timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => { if (!failure) out += chunk.toString(); if (out.length + err.length > 2_000_000) stop(`${command} output exceeded the limit`); });
    child.stderr.on("data", (chunk: Buffer) => { if (!failure) err += chunk.toString(); if (out.length + err.length > 2_000_000) stop(`${command} output exceeded the limit`); });
    child.stdin.on("error", () => {});
    child.on("error", (e) => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); reject(new Error(`${command} could not start: ${redact(e.message)}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (failure || code !== 0) reject(new Error(failure || `${command} exited ${code}: ${redact(err).slice(-1500)}`));
      else resolve(redact(out).trim());
    });
    child.stdin.end(input);
  });
}
