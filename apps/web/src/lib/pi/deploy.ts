import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'

import { LOG_FILE, PID_FILE, startScript, stopScript } from './process'
import { exec, execStream, openSftp, sh } from './ssh'

/*
 * Server only: copies `raspberry-pi-script/` to the Pi, installs its
 * dependencies and starts it in the background.
 */

const SKIP = new Set(['node_modules', '.git', '.DS_Store', '.turbo', LOG_FILE, PID_FILE])
const UPLOAD_CONCURRENCY = 8

/** `RASPBERRY_PI_SCRIPT_DIR`, or `raspberry-pi-script/` at the repo root (the dev server runs in apps/web). */
export function localScriptDir(): string {
  return path.resolve(
    process.env.RASPBERRY_PI_SCRIPT_DIR ??
      path.join(process.cwd(), '..', '..', 'raspberry-pi-script'),
  )
}

interface LocalTree {
  dirs: string[]
  files: string[]
}

async function walk(root: string, relative = '', tree: LocalTree = { dirs: [], files: [] }) {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      tree.dirs.push(rel)
      await walk(root, rel, tree)
    } else if (entry.isFile()) {
      tree.files.push(rel)
    }
  }
  return tree
}

function fastPut(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()))
  })
}

async function uploadAll(
  sftp: SFTPWrapper,
  localRoot: string,
  remoteRoot: string,
  files: string[],
  log: (line: string) => void,
) {
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      await fastPut(sftp, path.join(localRoot, file), `${remoteRoot}/${file}`)
      done++
      log(`  uploaded ${file} (${done}/${files.length})`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker))
}

async function run(conn: Client, command: string, what: string) {
  const { code, stderr } = await exec(conn, command)
  if (code !== 0) throw new Error(`${what} failed: ${stderr.trim() || `exit code ${code}`}`)
}

export async function deployScript(
  conn: Client,
  remotePath: string,
  log: (line: string) => void,
): Promise<void> {
  const localRoot = localScriptDir()
  const tree = await walk(localRoot).catch(() => {
    throw new Error(`The local script folder ${localRoot} could not be read`)
  })
  if (!tree.files.includes('package.json')) {
    throw new Error(`${localRoot} has no package.json, so the Pi would not know how to start it`)
  }

  log('Stopping the running script, if any...')
  await stopScript(conn, remotePath)

  log(`Clearing ~/${remotePath} on the Pi...`)
  const dir = sh(remotePath)
  await run(conn, `rm -rf ${dir} && mkdir -p ${dir}`, 'Clearing the folder')
  if (tree.dirs.length) {
    await run(conn, `cd ${dir} && mkdir -p ${tree.dirs.map(sh).join(' ')}`, 'Creating the folders')
  }

  log(`Uploading ${tree.files.length} files from ${localRoot}...`)
  const sftp = await openSftp(conn)
  try {
    await uploadAll(sftp, localRoot, remotePath, tree.files, log)
  } finally {
    sftp.end()
  }

  log('Running npm install on the Pi (this can take a while on a Pi)...')
  const installCode = await execStream(
    conn,
    `cd ${dir} && npm install --no-audit --no-fund 2>&1`,
    (line) => {
      if (line.trim()) log(`  ${line}`)
    },
  )
  if (installCode !== 0) throw new Error(`npm install failed with exit code ${installCode}`)

  log('Starting the script in the background...')
  const status = await startScript(conn, remotePath)
  if (!status.running) {
    const { stdout } = await exec(conn, `tail -n 20 ${dir}/${LOG_FILE}`)
    throw new Error(`The script exited right after starting. Last output:\n${stdout.trim()}`)
  }
  log(`Script is running (pid ${status.pid}).`)
}
