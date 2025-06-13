# Build Instructions

## Prerequisites

- Deno (latest version)
- Node.js 18+
- Git

## Building Claude-Flow

### For Local Development

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-flow

# Install globally for development
npm link

# Verify installation
claude-flow --version
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Check TypeScript types
npm run typecheck

# Run linter
npm run lint
```

### Development Workflow

1. Make your changes
2. Test locally: `claude-flow [command]`
3. Run tests: `npm test`
4. Check types: `npm run typecheck`

### Building for Distribution

```bash
# Build the project
npm run build

# Package for npm
npm pack
```

## Known Issues

- `deno compile` has a stack overflow issue, which is why we use the launcher script
- TypeScript has some errors (182) but they don't affect functionality
- Some import warnings about `.ts` extensions can be ignored

## Architecture

The project uses:
- **Runtime**: Deno for execution
- **Launcher**: Node.js wrapper script to avoid Deno compile issues
- **Global Access**: npm link creates a global symlink
- **Entry Point**: `bin/claude-flow-launcher` → `src/cli/main.ts`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.