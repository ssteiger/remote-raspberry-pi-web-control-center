import { Client } from 'ssh2'
import express from 'express'
const app = express()

// SSH connection handler
function connectToPI(host, username, password) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({ host, username, password })
  })
}

// API endpoints
app.get('/api/files/:path', async (req, res) => {
  // Read file content via SSH
})

app.post('/api/files/:path', async (req, res) => {
  // Write file content via SSH
})

app.get('/api/directory/:path', async (req, res) => {
  // List directory contents
})

app.listen(3000, () => {
  console.log('\n')
  console.log('Server is running on port 3000')
})