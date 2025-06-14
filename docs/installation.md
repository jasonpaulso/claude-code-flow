# Installation Guide

## Prerequisites

- **Deno** (required): Install from [deno.land](https://deno.land/)
- **Node.js** (required): Version 18+ for the launcher script
- **Git** (optional): For cloning the repository

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow
```

### 2. Install Globally

```bash
# Link the package globally
npm link

# Verify installation
claude-flow --version
```

You should see: `claude-flow v1.0.43`

## Usage

Once installed globally, you can use `claude-flow` from any directory:

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize Claude-Flow in your project
claude-flow init

# Run a swarm task
claude-flow swarm new "Refactor authentication system"

# Test with dry-run
claude-flow swarm new "Test task" --dry-run
```

## How It Works

The installation creates a global symlink to the `claude-flow-launcher` script, which:

1. Wraps Deno execution to avoid stack overflow issues
2. Provides a clean CLI interface
3. Handles all path resolution automatically

## Updating

To update Claude-Flow:

```bash
# Pull latest changes
cd /path/to/claude-flow
git pull

# Re-link if needed
npm link
```

## Uninstalling

To remove the global installation:

```bash
# Unlink the package
npm unlink -g claude-flow

# Or manually remove the symlink
rm $(which claude-flow)
```

## Troubleshooting

### Command Not Found

If `claude-flow` is not found after installation:

1. Check npm's global bin directory is in your PATH:

   ```bash
   npm bin -g
   echo $PATH
   ```

2. Try reinstalling:
   ```bash
   cd /path/to/claude-flow
   npm unlink
   npm link
   ```

### Permission Errors

If you get permission errors during `npm link`:

```bash
# Use sudo (not recommended)
sudo npm link

# Or fix npm permissions (recommended)
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
```

### Deno Errors

Ensure Deno is properly installed:

```bash
# Check Deno installation
deno --version

# If not installed, install it:
curl -fsSL https://deno.land/x/install/install.sh | sh
```

## Next Steps

- Run `claude-flow --help` to see all available commands
- Read the [Getting Started Guide](./01-getting-started.md)
- Configure your environment with `ANTHROPIC_API_KEY`
- Create a `CLAUDE.md` file in your project for custom instructions
