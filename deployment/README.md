# Deployment Guide - Oracle Cloud Free Tier

Complete guide for deploying the Daisu physics server to Oracle Cloud's Always Free tier.

---

## Overview

This guide will help you deploy the physics server to a free Oracle Cloud VM with:
- **Resources**: 2 ARM cores, 12GB RAM (free forever)
- **OS**: Ubuntu 22.04 LTS
- **Runtime**: Node.js 20 + PM2
- **Cost**: $0/month

---

## Prerequisites

- Oracle Cloud account ([oracle.com/cloud/free](https://www.oracle.com/cloud/free/))
- SSH client (Terminal on Mac/Linux, PuTTY on Windows)
- Domain name (optional, for custom URL)

---

## Step 1: Create Oracle Cloud VM

### 1.1 Sign Up

1. Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
2. Click "Start for free"
3. Fill in account details
4. Verify email and phone
5. Add payment method (won't be charged for free tier)

### 1.2 Create Compute Instance

1. **Log in** to Oracle Cloud Console
2. **Navigate** to: Hamburger menu → Compute → Instances
3. **Click** "Create Instance"

4. **Configure Instance:**

   **Name**: `daisu-physics-server`

   **Placement**:
   - Availability domain: (leave default)

   **Image and Shape**:
   - Click "Edit" on Image and Shape
   - **Image**: Canonical Ubuntu 22.04 (Minimal or Default)
   - **Shape**: VM.Standard.A1.Flex (Ampere ARM)
     - OCPUs: **2**
     - Memory (GB): **12**
     - Ensure "Always Free-eligible" is shown

   **Networking**:
   - VCN: (create new or select default)
   - Subnet: (create new or select default)
   - ✅ **Assign a public IPv4 address**

   **Add SSH Keys**:
   - Click "Generate a key pair for me"
   - **Download** both private and public keys
   - Save as `daisu-server.key` (important!)

   **Boot Volume**:
   - Size: **100 GB** (or up to 200 GB, both free)

5. **Click** "Create"

   Wait ~2-3 minutes for provisioning.

### 1.3 Note Important Details

Once created, note:
- **Public IP Address**: `xxx.xxx.xxx.xxx`
- **Username**: `ubuntu` (for Ubuntu instances)
- **SSH Key**: `daisu-server.key` (downloaded earlier)

---

## Step 2: Configure Firewall

### 2.1 VCN Security List (Oracle Cloud Firewall)

1. Go to instance details page
2. Click on the **Subnet** link
3. Click on the **Security List** (e.g., "Default Security List")
4. Click "Add Ingress Rules"

**Add these rules:**

| Rule | Stateless | Source | IP Protocol | Source Port | Destination Port | Description |
|------|-----------|--------|-------------|-------------|------------------|-------------|
| 1 | No | 0.0.0.0/0 | TCP | All | 22 | SSH |
| 2 | No | 0.0.0.0/0 | TCP | All | 3001 | Physics Server |
| 3 | No | 0.0.0.0/0 | TCP | All | 80 | HTTP (optional) |
| 4 | No | 0.0.0.0/0 | TCP | All | 443 | HTTPS (optional) |

Click "Add Ingress Rules" after each.

### 2.2 Ubuntu Firewall (UFW)

We'll configure this later after SSH-ing in.

---

## Step 3: SSH Into VM

### 3.1 Set Key Permissions (Mac/Linux)

```bash
chmod 400 ~/Downloads/daisu-server.key
```

### 3.2 Connect via SSH

```bash
ssh -i ~/Downloads/daisu-server.key ubuntu@<PUBLIC_IP>
```

Replace `<PUBLIC_IP>` with your instance's public IP.

**First login**: Type "yes" when prompted to accept the host key.

You should see:
```
Welcome to Ubuntu 22.04.x LTS
...
ubuntu@daisu-physics-server:~$
```

---

## Step 4: Install Dependencies

### 4.1 Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### 4.2 Install Node.js 20

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show v10.x.x
```

### 4.3 Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### 4.4 Install Git

```bash
sudo apt install -y git
```

### 4.5 Install Build Tools (for native modules)

```bash
sudo apt install -y build-essential python3
```

---

## Step 5: Configure Firewall (UFW)

```bash
# Allow SSH (important! don't lock yourself out)
sudo ufw allow 22/tcp

# Allow physics server
sudo ufw allow 3001/tcp

# Allow HTTP/HTTPS (optional, for future use)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Verify rules
sudo ufw status
```

---

## Step 6: Deploy Physics Server

### 6.1 Clone Repository

```bash
# Clone your repo (replace with your repo URL)
git clone https://github.com/<your-username>/dicesuki.git
cd dicesuki/server
```

**Or upload manually:**

```bash
# On your local machine, from /server directory:
scp -i ~/Downloads/daisu-server.key -r . ubuntu@<PUBLIC_IP>:~/daisu-server/

# Then on the server:
cd ~/daisu-server
```

### 6.2 Install Dependencies

```bash
npm install
```

### 6.3 Configure Environment

```bash
# Create .env file
nano .env
```

Paste:

```bash
NODE_ENV=production
PORT=3001

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

PHYSICS_TICK_RATE=60
BROADCAST_TICK_RATE=20

MAX_PLAYERS_PER_ROOM=8
MAX_DICE_PER_ROOM=32

LOG_LEVEL=info
LOG_PHYSICS_STATS=false
```

**Replace** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with your values from Supabase dashboard.

**Save**: Press `Ctrl+X`, then `Y`, then `Enter`

### 6.4 Build Server

```bash
npm run build
```

Verify `dist/` folder was created:

```bash
ls dist/
# Should show: index.js, config.js, physics/, room/, network/, types/
```

---

## Step 7: Run with PM2

### 7.1 Start Server

```bash
pm2 start dist/index.js --name daisu-physics
```

### 7.2 Verify Running

```bash
pm2 status
```

You should see:

```
┌────┬────────────────────┬──────────┬──────┬───────────┬─────────┬─────────┐
│ id │ name               │ mode     │ ↺    │ status    │ cpu     │ memory  │
├────┼────────────────────┼──────────┼──────┼───────────┼─────────┼─────────┤
│ 0  │ daisu-physics      │ fork     │ 0    │ online    │ 0%      │ 50.0mb  │
└────┴────────────────────┴──────────┴──────┴───────────┴─────────┴─────────┘
```

### 7.3 View Logs

```bash
pm2 logs daisu-physics
```

You should see:

```
╔════════════════════════════════════════╗
║  Daisu Physics Server                 ║
╚════════════════════════════════════════╝

Server Configuration:
  Environment: production
  Port: 3001
  Physics Tick Rate: 60 FPS
  Broadcast Rate: 20 Hz
  ...

Server running on port 3001
Ready for connections!
```

### 7.4 Auto-Start on Reboot

```bash
# Generate startup script
pm2 startup

# Copy and run the command PM2 outputs
# It will look like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Save current PM2 processes
pm2 save
```

Now the server will automatically restart if the VM reboots.

---

## Step 8: Test Connection

### 8.1 Health Check

From your **local machine**:

```bash
curl http://<PUBLIC_IP>:3001/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-11-16T...",
  "uptime": 123.456
}
```

### 8.2 WebSocket Test

Use the test client from `server/README.md`:

```javascript
// test-client.js
import { io } from 'socket.io-client'

const socket = io('http://<PUBLIC_IP>:3001')

socket.on('connect', () => {
  console.log('✅ Connected!')
})

socket.on('connect_error', (error) => {
  console.error('❌ Connection failed:', error)
})
```

Run:

```bash
node test-client.js
```

---

## Step 9: Update Client Configuration

In your **client project**, update `.env.local`:

```bash
VITE_PHYSICS_SERVER_URL=http://<PUBLIC_IP>:3001
```

Or for production build:

```bash
VITE_PHYSICS_SERVER_URL=https://your-domain.com  # If using domain + SSL
```

---

## Step 10: Optional - Set Up Domain & SSL

### 10.1 Point Domain to Server

In your domain's DNS settings (e.g., Cloudflare, Namecheap):

```
Type: A Record
Name: physics (or @)
Value: <PUBLIC_IP>
TTL: Auto
```

Wait for DNS propagation (~5-60 minutes).

Verify:

```bash
ping physics.yourdomain.com
```

### 10.2 Install SSL Certificate (Let's Encrypt)

Install Certbot:

```bash
sudo apt install -y certbot
```

Get certificate:

```bash
sudo certbot certonly --standalone -d physics.yourdomain.com
```

Configure NGINX as reverse proxy (optional):

```bash
sudo apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/physics
```

Paste:

```nginx
server {
    listen 80;
    server_name physics.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name physics.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/physics.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/physics.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/physics /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Now clients can connect via:

```
wss://physics.yourdomain.com
```

---

## Monitoring & Maintenance

### PM2 Commands

```bash
# Status
pm2 status

# Logs (real-time)
pm2 logs daisu-physics

# Logs (last 100 lines)
pm2 logs daisu-physics --lines 100

# Monitor (CPU, memory)
pm2 monit

# Restart
pm2 restart daisu-physics

# Stop
pm2 stop daisu-physics

# Delete
pm2 delete daisu-physics
```

### System Resources

```bash
# CPU, memory, disk usage
htop

# Disk space
df -h

# Network usage
sudo iftop
```

### Update Server

```bash
cd ~/dicesuki/server

# Pull latest code
git pull

# Install dependencies
npm install

# Rebuild
npm run build

# Restart PM2
pm2 restart daisu-physics
```

---

## Troubleshooting

### Server Won't Start

**Check logs:**

```bash
pm2 logs daisu-physics --err
```

**Common issues:**

- **Port in use**: Kill existing process or change port
- **Missing env vars**: Check `.env` file
- **Build failed**: Run `npm run build` again

### Can't Connect from Client

**Check firewall:**

```bash
# Oracle Cloud (VCN Security List)
# Ensure port 3001 ingress rule exists

# Ubuntu (UFW)
sudo ufw status
sudo ufw allow 3001/tcp
```

**Check server is running:**

```bash
pm2 status
curl http://localhost:3001/health
```

**Check CORS:**

In `server/src/network/SocketServer.ts`, ensure:

```typescript
cors: {
  origin: '*',  // Or specific domain in production
  methods: ['GET', 'POST'],
}
```

### High Memory Usage

**Check per-process memory:**

```bash
pm2 monit
```

**If over 500MB per room:**

- Reduce `MAX_DICE_PER_ROOM`
- Reduce `PHYSICS_TICK_RATE` to 30 FPS
- Check for memory leaks in logs

### VM Suspended

Oracle may suspend free tier VMs if:
- CPU usage is too low (looks unused)
- Email not verified
- Payment method expired

**Prevention:**

- Keep at least one room active (or run a ping script)
- Verify email and keep payment method valid

---

## Cost Monitoring

### Always Free Resources

Oracle Cloud Free Tier includes:
- **2 ARM VMs** (4 OCPUs + 24 GB RAM total, split as desired)
- **200 GB block storage**
- **10 TB/month outbound transfer**

### Monitor Usage

Dashboard → Billing → Cost Analysis

Should show **$0.00** if using only free tier resources.

---

## Security Checklist

- [ ] SSH key-only authentication (disable password login)
- [ ] UFW firewall enabled
- [ ] Only required ports open (22, 3001, 80, 443)
- [ ] Supabase service role key in `.env` (not committed to Git)
- [ ] CORS configured to allow only your domain (production)
- [ ] SSL/TLS enabled (wss:// instead of ws://)
- [ ] Regular system updates (`sudo apt update && sudo apt upgrade`)

---

## Scaling Beyond Free Tier

If you outgrow the free tier (>15 concurrent rooms):

### Option 1: Multiple VMs (Free)

Oracle Free Tier allows **2 ARM VMs**. Deploy on both:

- VM 1: Rooms 1-15
- VM 2: Rooms 16-30

Use a load balancer or round-robin DNS.

### Option 2: Upgrade VM

Add more OCPUs and RAM (paid):

- 4 OCPUs, 24 GB RAM: ~$30/month
- 8 OCPUs, 48 GB RAM: ~$60/month

### Option 3: Managed Platform

Move to a managed platform:

- **Render**: $25/month for 2GB RAM
- **Railway**: $5 + usage
- **Fly.io**: ~$10-20/month

---

## Backup & Recovery

### Backup Code

Code is in Git, so just:

```bash
git push
```

### Backup Database

Supabase handles backups automatically.

### VM Snapshots (Optional)

Oracle Cloud → Compute → Boot Volumes → Create Backup

---

## Summary

You now have:

- ✅ Physics server running on Oracle Cloud (free forever)
- ✅ PM2 managing the process (auto-restart)
- ✅ Firewall configured
- ✅ SSL/TLS ready (optional)
- ✅ Monitoring with PM2

**Next Steps:**

1. Update client `.env.local` with server URL
2. Test multiplayer locally
3. Deploy client to hosting (Vercel, Netlify, etc.)
4. Test end-to-end multiplayer

---

## Support

For issues:
- Check PM2 logs: `pm2 logs daisu-physics`
- Check system logs: `sudo journalctl -u pm2-ubuntu`
- Oracle Cloud support: [oracle.com/cloud/support](https://www.oracle.com/cloud/support/)
