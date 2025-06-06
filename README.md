# Remote Raspberry Pi web control center

A react based frontend to remotely manage your local raspberry pi.

Programm your raspberry pi in `raspberry-pi-script`.

## Local development

```bash
# install dependencies
bun install

# start app
bun run dev:frontend

# open http://127.0.0.1:3000
```

## Setup Raspberry Pi

1. Download Raspberry Pi Imager [here](https://www.raspberrypi.com/software/)
2. Setup wifi settings and activate ssh
3. Connect to Raspberry Pi: `ssh pi@raspberrypi.local`

### Install Node.js on Raspberry Pi

```bash
# update system package list
sudo apt update
sudo apt upgrade
# install necessary packages
sudo apt install -y ca-certificates curl gnupg
# download and install latest version of Node.js
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
# set environment variables
NODE_MAJOR=20
NODE_MAJOR=22
# add the Node.JS repository to sources list
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
# update the package list
sudo apt update
# install nodejs
sudo apt install nodejs
# check if installation was successful
node -v
```

## Packages

- [tanstack/start](https://tanstack.com/start/latest)
- [shadcn/ui](https://ui.shadcn.com/docs/components)
- [lucide icons](https://lucide.dev)
- [sonner](https://sonner.emilkowal.ski/)
