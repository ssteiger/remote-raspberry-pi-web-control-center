import { createAPIFileRoute } from "@tanstack/react-start/api";
import { Client } from 'ssh2';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config();

interface SFTPError extends Error {
  code?: string;
}

interface SFTPClient {
  mkdir: (path: string, callback: (err: SFTPError | null) => void) => void;
  fastPut: (localPath: string, remotePath: string, callback: (err: SFTPError | null) => void) => void;
  end: () => void;
}

// SSH connection handler
function connectToPI(host: string, username: string, password: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host, username, password });
  });
}

// Function to recursively sync files
async function syncFiles(sftp: SFTPClient, localPath: string, remotePath: string): Promise<void> {
  const files = fs.readdirSync(localPath);
  
  for (const file of files) {
    const localFilePath = path.join(localPath, file);
    const remoteFilePath = path.join(remotePath, file).replace(/\\/g, '/');
    const stats = fs.statSync(localFilePath);
    
    if (stats.isDirectory()) {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(remoteFilePath, (err: SFTPError | null) => {
          if (err && err.code !== 'EEXIST') reject(err);
          else resolve();
        });
      });
      await syncFiles(sftp, localFilePath, remoteFilePath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFilePath, remoteFilePath, (err: SFTPError | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

export const APIRoute = createAPIFileRoute("/api")({
  POST: async () => {
    try {
      const host = process.env.RASPBERRY_PI_HOST || 'raspberrypi.local';
      const username = process.env.RASPBERRY_PI_USERNAME || 'pi';
      const password = process.env.RASPBERRY_PI_PASSWORD;

      if (!password) {
        return new Response(JSON.stringify({ error: 'Raspberry Pi password not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const conn = await connectToPI(host, username, password);
      const sftp = await new Promise<SFTPClient>((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) reject(err);
          else resolve(sftp as SFTPClient);
        });
      });

      const localPath = path.join(process.cwd(), 'raspberry-pi-script');
      const remotePath = '/home/pi/raspberry-pi-script';

      // Create remote directory if it doesn't exist
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(remotePath, (err: SFTPError | null) => {
          if (err && err.code !== 'EEXIST') reject(err);
          else resolve();
        });
      });

      // Sync files
      await syncFiles(sftp, localPath, remotePath);

      // Close connections
      sftp.end();
      conn.end();

      return new Response(JSON.stringify({ message: 'Files synced successfully' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error syncing files:', error);
      return new Response(JSON.stringify({ error: 'Failed to sync files' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
});