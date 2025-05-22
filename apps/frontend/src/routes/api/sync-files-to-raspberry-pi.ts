import { createAPIFileRoute } from "@tanstack/react-start/api";
import { Client } from 'ssh2';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SFTPError extends Error {
  code?: string;
}

interface SFTPAttributes {
  mode: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
  isDirectory: () => boolean;
}

interface SFTPDirectoryEntry {
  filename: string;
  longname: string;
  attrs: SFTPAttributes;
}

interface SFTPClient {
  mkdir: (path: string, callback: (err: SFTPError | null) => void) => void;
  fastPut: (localPath: string, remotePath: string, callback: (err: SFTPError | null) => void) => void;
  end: () => void;
  rmdir: (path: string, callback: (err: SFTPError | null) => void) => void;
  unlink: (path: string, callback: (err: SFTPError | null) => void) => void;
  readdir: (path: string, callback: (err: SFTPError | null, list: SFTPDirectoryEntry[]) => void) => void;
}

// SSH connection handler
function connectToPI(host: string, username: string, password: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    console.log(`Attempting to connect to ${host} as ${username}...`);
    conn.on('ready', () => {
      console.log('Successfully connected to Raspberry Pi');
      resolve(conn);
    });
    conn.on('error', (err) => {
      console.error('Connection error:', err);
      reject(err);
    });
    conn.connect({ host, username, password });
  });
}

// Function to create directories recursively
async function createDirectoryRecursively(sftp: SFTPClient, dirPath: string): Promise<void> {
  // Only create the final directory since parent directories already exist
  await new Promise<void>((resolve, reject) => {
    sftp.mkdir(dirPath, (err: SFTPError | null) => {
      if (err && err.code !== 'EEXIST') {
        console.error(`Error creating directory ${dirPath}:`, err);
        reject(err);
      } else {
        if (err?.code === 'EEXIST') {
          console.log(`Directory already exists: ${dirPath}`);
        }
        resolve();
      }
    });
  });
}

// Function to recursively remove a directory
async function removeDirectoryRecursively(sftp: SFTPClient, dirPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(`Checking directory: ${getRelativePath(dirPath)}`);
    sftp.readdir(dirPath, async (err, list) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // Directory doesn't exist, nothing to remove
          console.log(`Directory not found: ${getRelativePath(dirPath)}`);
          resolve();
          return;
        }
        reject(err);
        return;
      }

      try {
        // Process all files and directories in parallel
        await Promise.all(list.map(async (item) => {
          const itemPath = `${dirPath}/${item.filename}`;
          if (item.attrs.isDirectory()) {
            await removeDirectoryRecursively(sftp, itemPath);
          } else {
            await new Promise<void>((resolve, reject) => {
              sftp.unlink(itemPath, (err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            });
          }
        }));

        // Remove the directory itself
        await new Promise<void>((resolve, reject) => {
          sftp.rmdir(dirPath, (err) => {
            if (err) {
              console.error(`Error removing directory ${getRelativePath(dirPath)}:`, err);
              reject(err);
            } else {
              resolve();
            }
          });
        });

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Function to run npm install on the Raspberry Pi
async function runNpmInstall(conn: Client, remotePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log('Running npm install on Raspberry Pi...');
    conn.exec(`cd ${remotePath} && npm install`, (err, stream) => {
      if (err) {
        console.error('Error running npm install:', err);
        reject(err);
        return;
      }

      stream.on('data', (data: Buffer) => {
        console.log('npm install output:', data.toString());
      });

      stream.on('close', () => {
        console.log('npm install completed');
        resolve();
      });

      stream.on('error', (err: Error) => {
        console.error('Error in npm install stream:', err);
        reject(err);
      });
    });
  });
}

// Function to start the application on the Raspberry Pi
async function startApplication(conn: Client, remotePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log('Starting application on Raspberry Pi...');
    conn.exec(`cd ${remotePath} && npm run start`, (err, stream) => {
      if (err) {
        console.error('Error starting application:', err);
        reject(err);
        return;
      }

      stream.on('data', (data: Buffer) => {
        console.log('Application output:', data.toString());
      });

      stream.on('close', () => {
        console.log('Application started');
        resolve();
      });

      stream.on('error', (err: Error) => {
        console.error('Error in application stream:', err);
        reject(err);
      });
    });
  });
}

// Function to get relative path within raspberry-pi-script
function getRelativePath(fullPath: string): string {
  const parts = fullPath.split('raspberry-pi-script');
  return parts.length > 1 ? parts[1].replace(/^[/\\]/, '') : fullPath;
}

// Function to recursively sync files
async function syncFiles(sftp: SFTPClient, localPath: string, remotePath: string): Promise<void> {
  console.log(`Scanning directory: ${getRelativePath(localPath)}`);
  const files = fs.readdirSync(localPath);
  console.log(`Found ${files.length} items in ${getRelativePath(localPath)}`);
  
  for (const file of files) {
    // Skip node_modules directory
    if (file === 'node_modules') {
      console.log('Skipping node_modules directory');
      continue;
    }

    const localFilePath = path.join(localPath, file);
    const remoteFilePath = path.join(remotePath, file).replace(/\\/g, '/');
    const stats = fs.statSync(localFilePath);
    
    if (stats.isDirectory()) {
      console.log(`Creating directory: ${getRelativePath(remoteFilePath)}`);
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(remoteFilePath, (err: SFTPError | null) => {
          if (err && err.code !== 'EEXIST') {
            console.error(`Error creating directory ${getRelativePath(remoteFilePath)}:`, err);
            reject(err);
          } else {
            if (err?.code === 'EEXIST') {
              console.log(`Directory already exists: ${getRelativePath(remoteFilePath)}`);
            }
            resolve();
          }
        });
      });
      await syncFiles(sftp, localFilePath, remoteFilePath);
    } else {
      console.log(`Uploading file: ${getRelativePath(localFilePath)} -> ${getRelativePath(remoteFilePath)}`);
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFilePath, remoteFilePath, (err: SFTPError | null) => {
          if (err) {
            console.error(`Error uploading file ${getRelativePath(localFilePath)}:`, err);
            reject(err);
          } else {
            console.log(`Successfully uploaded: ${getRelativePath(remoteFilePath)}`);
            resolve();
          }
        });
      });
    }
  }
}

export const APIRoute = createAPIFileRoute("/api/sync-files-to-raspberry-pi")({
  POST: async () => {
    try {
      console.log('Starting file sync process...');
      const host = process.env.RASPBERRY_PI_HOST || 'raspberrypi.local';
      const username = process.env.RASPBERRY_PI_USERNAME || 'pi';
      const password = process.env.RASPBERRY_PI_PASSWORD;

      if (!password) {
        console.error('Raspberry Pi password not configured');
        return new Response(JSON.stringify({ error: 'Raspberry Pi password not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const conn = await connectToPI(host, username, password);
      console.log('Establishing SFTP connection...');
      const sftp = await new Promise<SFTPClient>((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) {
            console.error('SFTP connection error:', err);
            reject(err);
          } else {
            console.log('SFTP connection established');
            resolve(sftp as SFTPClient);
          }
        });
      });

      const localPath = path.join(__dirname, '../../../../..', 'raspberry-pi-script');
      const remotePath = `/home/${username}/raspberry-pi-script`;

      console.log(`Creating remote directory: ${remotePath}`);
      // Remove existing directory if it exists
      console.log('Checking for existing directory...');
      await removeDirectoryRecursively(sftp, remotePath);
      console.log('Removed existing directory if it existed');

      // Create remote directory and its parents if they don't exist
      await createDirectoryRecursively(sftp, remotePath);

      console.log('\n')
      console.log('Starting file synchronization...');
      // Sync files
      await syncFiles(sftp, localPath, remotePath);

      console.log('File synchronization completed successfully');
      console.log('\n')

      // Run npm install on the Raspberry Pi
      await runNpmInstall(conn, remotePath);

      // Start the application
      await startApplication(conn, remotePath);

      // Close connections
      console.log('Closing SFTP connection...');
      sftp.end();
      console.log('Closing SSH connection...');
      conn.end();
      console.log('All connections closed');

      return new Response(JSON.stringify({ message: 'Files synced successfully' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error during file sync process:', error);
      return new Response(JSON.stringify({ error: 'Failed to sync files' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
});