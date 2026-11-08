import type { Client } from 'ssh2'

import { exec, sh } from './ssh'
import type { ScriptStatus } from './types'

/*
 * Server only: the deployed script runs detached from the SSH session in its
 * own process group (`setsid`), with its pid in `app.pid` and its output in
 * `app.log`, both inside the deploy folder.
 */

export const PID_FILE = 'app.pid'
export const LOG_FILE = 'app.log'

export async function getScriptStatus(conn: Client, remotePath: string): Promise<ScriptStatus> {
  const dir = sh(remotePath)
  const { stdout } = await exec(
    conn,
    `pid=$(cat ${dir}/${PID_FILE} 2>/dev/null) && kill -0 "$pid" 2>/dev/null && echo "$pid $(ps -o etimes= -p "$pid" | tr -d ' ')"`,
  )
  const [pid, elapsed] = stdout.trim().split(/\s+/).map(Number)
  if (!pid) return { running: false, pid: null, uptimeSeconds: null }
  return { running: true, pid, uptimeSeconds: Number.isFinite(elapsed) ? elapsed : null }
}

export async function startScript(conn: Client, remotePath: string): Promise<ScriptStatus> {
  const current = await getScriptStatus(conn, remotePath)
  if (current.running) return current

  const dir = sh(remotePath)
  const { code, stderr } = await exec(
    conn,
    [
      `cd ${dir} || { echo "The folder ${remotePath} does not exist on the Pi. Deploy first." >&2; exit 1; }`,
      `[ -f package.json ] || { echo "No package.json in ${remotePath}. Deploy first." >&2; exit 1; }`,
      `echo "--- started $(date -Iseconds) ---" >> ${LOG_FILE}`,
      `setsid nohup npm run start >> ${LOG_FILE} 2>&1 < /dev/null &`,
      `echo $! > ${PID_FILE}`,
    ].join('\n'),
  )
  if (code !== 0) throw new Error(stderr.trim() || 'Could not start the script')

  // Give it a moment, so a script that crashes on start up shows as stopped.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return getScriptStatus(conn, remotePath)
}

export async function stopScript(conn: Client, remotePath: string): Promise<void> {
  const dir = sh(remotePath)
  await exec(
    conn,
    [
      `pid=$(cat ${dir}/${PID_FILE} 2>/dev/null) || exit 0`,
      `if kill -0 "$pid" 2>/dev/null; then`,
      `  kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null`,
      `  for i in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done`,
      `  kill -KILL -- -"$pid" 2>/dev/null`,
      `  echo "--- stopped $(date -Iseconds) ---" >> ${dir}/${LOG_FILE}`,
      'fi',
      `rm -f ${dir}/${PID_FILE}`,
    ].join('\n'),
  )
}

export async function restartScript(conn: Client, remotePath: string): Promise<ScriptStatus> {
  await stopScript(conn, remotePath)
  return startScript(conn, remotePath)
}
