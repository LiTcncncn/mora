import { execFileSync } from "node:child_process";

const GATEWAY_MARK = "src/device-gateway/main.ts";

export function otherGatewayPids(psOutput: string, selfPid: number): number[] {
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2] ?? "";
    if (!Number.isInteger(pid) || pid === selfPid) continue;
    if (!command.includes(GATEWAY_MARK)) continue;
    pids.push(pid);
  }
  return pids;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepMs(ms: number): void {
  execFileSync("sleep", [String(ms / 1000)]);
}

/** 结束仍占着开发板连接的旧网关。新进程若直接再监听，板子不会换到新网关，麦克风电平就停在旧进程里。 */
export function releasePreviousGateways(selfPid = process.pid): void {
  let output = "";
  try {
    output = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  } catch {
    return;
  }
  const stale = otherGatewayPids(output, selfPid);
  if (stale.length === 0) return;
  for (const pid of stale) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 进程已经退出。
    }
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && stale.some((pid) => processAlive(pid))) {
    sleepMs(100);
  }
  for (const pid of stale) {
    if (!processAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 进程已经退出。
    }
  }
  console.log(`[device-gateway] 已结束旧网关 ${stale.join(", ")}，开发板会重新连接`);
}
