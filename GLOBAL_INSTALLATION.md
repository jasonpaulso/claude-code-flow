# Global Installation Guide for Claude-Flow

This guide provides instructions for installing Claude-Flow globally in different environments.

## Prerequisites

1. **Node.js 16+** and **npm** installed
2. **Deno** (will be installed automatically if not present)
3. **Git** (for cloning from source)

## Method 1: NPM Global Installation (Recommended)

### For macOS/Linux:

```bash
# Install globally from npm
npm install -g claude-flow@latest

# Verify installation
claude-flow --version

# Initialize in your project directory
cd /path/to/your/project
claude-flow init --sparc

# Use the global command
claude-flow swarm new "Test task" --dry-run
```

### For Windows:

```powershell
# Install globally from npm
npm install -g claude-flow@latest

# Verify installation
claude-flow --version

# Initialize in your project directory
cd C:\path\to\your\project
claude-flow init --sparc

# Use the global command
claude-flow swarm new "Test task" --dry-run
```

## Method 2: Manual Global Installation from Source

### Step 1: Clone and Build

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow

# Install dependencies
npm install

# Make launcher executable (macOS/Linux)
chmod +x bin/claude-flow-launcher
```

### Step 2: Create Global Link

#### For macOS/Linux:

```bash
# Option A: Using npm link (Recommended)
npm link

# Option B: Manual symlink
sudo ln -s $(pwd)/bin/claude-flow-launcher /usr/local/bin/claude-flow

# Option C: Add to PATH in ~/.bashrc or ~/.zshrc
echo 'export PATH="'$(pwd)'/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### For Windows:

```powershell
# Option A: Using npm link
npm link

# Option B: Add to PATH manually
# 1. Copy the full path to claude-code-flow\bin
# 2. Open System Properties > Environment Variables
# 3. Add the path to System or User PATH variable
# 4. Restart terminal

# Option C: Create batch file
echo @echo off > %USERPROFILE%\bin\claude-flow.bat
echo node "%CD%\bin\claude-flow-launcher" %* >> %USERPROFILE%\bin\claude-flow.bat
# Then add %USERPROFILE%\bin to PATH
```

### Step 3: Verify Global Installation

```bash
# Test from any directory
cd ~
claude-flow --version
# Should output: claude-flow v1.0.49

# Test help
claude-flow --help

# Test swarm command
claude-flow swarm --help
```

## Method 3: Docker Installation (Cross-Platform)

### Create Dockerfile:

```dockerfile
FROM denoland/deno:alpine-1.40.0

# Install Node.js for npm compatibility
RUN apk add --no-cache nodejs npm git

# Clone Claude-Flow
RUN git clone https://github.com/ruvnet/claude-code-flow.git /opt/claude-flow

WORKDIR /opt/claude-flow

# Install dependencies
RUN npm install

# Make launcher executable
RUN chmod +x bin/claude-flow-launcher

# Create global link
RUN ln -s /opt/claude-flow/bin/claude-flow-launcher /usr/local/bin/claude-flow

# Set working directory to user's project
WORKDIR /workspace

# Entry point
ENTRYPOINT ["claude-flow"]
```

### Build and Use:

```bash
# Build Docker image
docker build -t claude-flow:latest .

# Create alias for easy usage
alias claude-flow='docker run -it --rm -v $(pwd):/workspace claude-flow:latest'

# Use it
claude-flow --version
claude-flow swarm new "Test task" --dry-run
```

## Environment-Specific Setup

### For CI/CD Pipelines:

```yaml
# GitHub Actions
- name: Install Claude-Flow
  run: |
    npm install -g claude-flow@latest
    claude-flow --version

# GitLab CI
before_script:
  - npm install -g claude-flow@latest
  - claude-flow --version

# Jenkins
sh 'npm install -g claude-flow@latest'
sh 'claude-flow --version'
```

### For Development Teams:

Create a setup script (`setup-claude-flow.sh`):

```bash
#!/bin/bash

# Check if claude-flow is installed
if ! command -v claude-flow &> /dev/null; then
    echo "Installing Claude-Flow globally..."
    npm install -g claude-flow@latest
else
    echo "Claude-Flow already installed"
fi

# Verify version
claude-flow --version

# Initialize project if not already done
if [ ! -f "CLAUDE.md" ]; then
    echo "Initializing Claude-Flow for this project..."
    claude-flow init --sparc
fi

echo "Claude-Flow setup complete!"
```

## Using Global Installation

Once installed globally, you can use Claude-Flow from any directory:

```bash
# Navigate to any project
cd /path/to/my/project

# Initialize Claude-Flow for the project
claude-flow init --sparc

# Run swarm commands
claude-flow swarm new "Build feature X" --dry-run
claude-flow swarm new "Test application" --max-agents 2

# Memory operations
claude-flow memory store "project-info" "My project data"
claude-flow memory query "project"

# Check status
claude-flow status
```

## Troubleshooting Global Installation

### Issue: Command not found

```bash
# Check npm global bin directory
npm config get prefix

# Add to PATH (macOS/Linux)
export PATH="$(npm config get prefix)/bin:$PATH"

# Add to PATH (Windows)
# Add the output of: npm config get prefix
# Plus \bin to your system PATH
```

### Issue: Permission denied

```bash
# Fix npm permissions (macOS/Linux)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Or use npx instead
npx claude-flow@latest --version
```

### Issue: Wrong version

```bash
# Update to latest
npm update -g claude-flow

# Or reinstall
npm uninstall -g claude-flow
npm install -g claude-flow@latest
```

## Best Practices

1. **Version Management**: Pin specific versions in production
   ```bash
   npm install -g claude-flow@1.0.49
   ```

2. **Team Consistency**: Use package.json for team projects
   ```json
   {
     "devDependencies": {
       "claude-flow": "^1.0.49"
     }
   }
   ```

3. **Environment Variables**: Set defaults globally
   ```bash
   export CLAUDE_FLOW_SWARM_MAX_AGENTS=10
   export CLAUDE_FLOW_LOG_LEVEL=info
   ```

## Uninstalling

To remove global installation:

```bash
# NPM installation
npm uninstall -g claude-flow

# Manual installation
rm /usr/local/bin/claude-flow
# Or remove from PATH

# Docker
docker rmi claude-flow:latest
```

## Next Steps

After global installation:

1. Read the [Getting Started Guide](./docs/01-getting-started.md)
2. Check [Troubleshooting Guide](./docs/10-troubleshooting.md) for common issues
3. Review [Environment Variables](./docs/environment-variables.md) for configuration

**Note**: The current version uses `claude-flow-launcher` due to a known build issue. This is handled automatically in the global installation.