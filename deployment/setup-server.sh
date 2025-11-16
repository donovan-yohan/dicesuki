#!/bin/bash

##############################################################################
# Daisu Physics Server - Automated Setup Script
# Run this on a fresh Ubuntu 22.04 VM (Oracle Cloud, DigitalOcean, etc.)
##############################################################################

set -e  # Exit on error

echo "╔════════════════════════════════════════╗"
echo "║  Daisu Physics Server Setup           ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

##############################################################################
# Step 1: Update System
##############################################################################

info "Updating system packages..."
sudo apt update
sudo apt upgrade -y

##############################################################################
# Step 2: Install Node.js 20
##############################################################################

if command -v node &> /dev/null; then
    info "Node.js already installed: $(node --version)"
else
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    info "Node.js installed: $(node --version)"
fi

##############################################################################
# Step 3: Install PM2
##############################################################################

if command -v pm2 &> /dev/null; then
    info "PM2 already installed: $(pm2 --version)"
else
    info "Installing PM2..."
    sudo npm install -g pm2
    info "PM2 installed: $(pm2 --version)"
fi

##############################################################################
# Step 4: Install Git
##############################################################################

if command -v git &> /dev/null; then
    info "Git already installed: $(git --version)"
else
    info "Installing Git..."
    sudo apt install -y git
    info "Git installed: $(git --version)"
fi

##############################################################################
# Step 5: Install Build Tools
##############################################################################

info "Installing build tools..."
sudo apt install -y build-essential python3

##############################################################################
# Step 6: Configure Firewall (UFW)
##############################################################################

info "Configuring firewall..."
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 3001/tcp # Physics server
sudo ufw allow 80/tcp   # HTTP (optional)
sudo ufw allow 443/tcp  # HTTPS (optional)

# Enable firewall (only if not already enabled)
if ! sudo ufw status | grep -q "Status: active"; then
    warn "Firewall not enabled. Enabling now..."
    echo "y" | sudo ufw enable
else
    info "Firewall already enabled"
fi

info "Firewall status:"
sudo ufw status

##############################################################################
# Step 7: Clone Repository or Setup Directory
##############################################################################

echo ""
read -p "Do you want to clone the repository? (y/n): " CLONE_REPO

if [[ "$CLONE_REPO" == "y" ]]; then
    read -p "Enter repository URL: " REPO_URL
    read -p "Enter target directory (default: ~/dicesuki): " TARGET_DIR
    TARGET_DIR=${TARGET_DIR:-~/dicesuki}

    if [ -d "$TARGET_DIR" ]; then
        warn "Directory $TARGET_DIR already exists. Skipping clone."
    else
        info "Cloning repository to $TARGET_DIR..."
        git clone "$REPO_URL" "$TARGET_DIR"
    fi

    SERVER_DIR="$TARGET_DIR/server"
else
    warn "Skipping repository clone. You'll need to upload files manually."
    read -p "Enter server directory path (default: ~/daisu-server): " SERVER_DIR
    SERVER_DIR=${SERVER_DIR:-~/daisu-server}

    if [ ! -d "$SERVER_DIR" ]; then
        info "Creating directory: $SERVER_DIR"
        mkdir -p "$SERVER_DIR"
    fi
fi

##############################################################################
# Step 8: Setup Server
##############################################################################

if [ -d "$SERVER_DIR" ] && [ -f "$SERVER_DIR/package.json" ]; then
    info "Setting up server in $SERVER_DIR..."

    cd "$SERVER_DIR"

    # Install dependencies
    info "Installing dependencies..."
    npm install

    # Create .env if not exists
    if [ ! -f ".env" ]; then
        warn ".env file not found. Creating from .env.example..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
            warn "Please edit .env file with your Supabase credentials:"
            echo "  nano $SERVER_DIR/.env"
        else
            error ".env.example not found. Please create .env manually."
        fi
    else
        info ".env file already exists"
    fi

    # Build server
    info "Building server..."
    npm run build

    if [ -d "dist" ]; then
        info "Build successful! dist/ folder created."
    else
        error "Build failed. Check for errors above."
        exit 1
    fi
else
    warn "Server files not found in $SERVER_DIR. Skipping setup."
    warn "Upload your server files to $SERVER_DIR and run:"
    echo "  cd $SERVER_DIR"
    echo "  npm install"
    echo "  npm run build"
    exit 0
fi

##############################################################################
# Step 9: Start with PM2
##############################################################################

echo ""
read -p "Start server with PM2 now? (y/n): " START_NOW

if [[ "$START_NOW" == "y" ]]; then
    info "Starting server with PM2..."

    # Stop if already running
    pm2 delete daisu-physics 2>/dev/null || true

    # Start server
    pm2 start dist/index.js --name daisu-physics

    # Save PM2 state
    pm2 save

    # Setup auto-start on reboot
    info "Configuring PM2 to start on boot..."
    pm2 startup | grep "sudo" | bash || true
    pm2 save

    info "Server started!"
    pm2 status
    echo ""
    info "View logs with: pm2 logs daisu-physics"
else
    info "Skipping PM2 start. Start manually with:"
    echo "  cd $SERVER_DIR"
    echo "  pm2 start dist/index.js --name daisu-physics"
    echo "  pm2 save"
fi

##############################################################################
# Step 10: Summary
##############################################################################

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  Setup Complete!                       ║"
echo "╚════════════════════════════════════════╝"
echo ""
info "Next steps:"
echo ""
echo "  1. Edit .env file with Supabase credentials:"
echo "     nano $SERVER_DIR/.env"
echo ""
echo "  2. Test health endpoint:"
echo "     curl http://localhost:3001/health"
echo ""
echo "  3. View logs:"
echo "     pm2 logs daisu-physics"
echo ""
echo "  4. Get public IP:"
echo "     curl ifconfig.me"
echo ""
echo "  5. Update client .env.local:"
echo "     VITE_PHYSICS_SERVER_URL=http://<PUBLIC_IP>:3001"
echo ""
info "Firewall ports opened: 22, 3001, 80, 443"
info "PM2 configured to auto-start on reboot"
echo ""
info "Happy dice rolling! 🎲"
echo ""
