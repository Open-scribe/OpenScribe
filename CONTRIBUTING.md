# Contributing to OpenScribe

Thanks for your interest in contributing to OpenScribe.

OpenScribe is an MIT-licensed, local-first, open-source AI medical scribe.
The goal is to provide transparent, auditable infrastructure rather than a
closed SaaS product.

## Project Philosophy

- Local-first by default
- Explicit data boundaries
- No telemetry or analytics
- Provider-agnostic, modular design
- AI output is always a draft requiring human review

## Ways to Contribute

You do NOT need clinical experience to contribute.

High-priority contribution areas:
- Error handling and edge cases
- Test coverage (unit + integration)
- Documentation and developer onboarding
- Accessibility and UX improvements
- LLM provider adapters
- Transcription backend adapters
- Pipeline evaluation and validation

## Getting Started

### Initial Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenScribe.git
   cd OpenScribe
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Set up environment:
   ```bash
   pnpm run setup
   # Then edit apps/web/.env.local with your API keys
   ```
5. Start the dev server:
   ```bash
   pnpm dev          # Web app
   pnpm dev:desktop  # Desktop app
   ```

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/descriptive-name
   ```
2. Make changes with clear commits
3. Add or update tests where applicable
4. Run tests:
   ```bash
   pnpm test         # All tests
   pnpm test:llm     # LLM tests
   pnpm test:note    # Note generation tests
   ```
5. Run linter:
   ```bash
   pnpm lint
   ```
6. Submit a Pull Request

## Code Standards

- TypeScript with explicit types
- No implicit `any`
- Prefer small, composable modules
- Follow existing folder structure
- Avoid introducing analytics, tracking, or telemetry
- Include JSDoc comments for public APIs
- Write tests for new functionality

## Project Structure

- `apps/web/` – Next.js frontend + API routes
- `packages/pipeline/` – Audio ingest, transcription, assembly, evaluation
- `packages/ui/` – Shared React components
- `packages/storage/` – Encrypted storage + encounter management
- `packages/llm/` – Provider-agnostic LLM client
- `packages/shell/` – Electron main process
- `config/` – Shared configuration files

See [architecture.md](./architecture.md) for detailed architecture documentation.

## Testing

- Write tests for new features and bug fixes
- Place tests in `__tests__` directories or `*.test.ts` files
- Use the Node.js built-in test runner
- Mock external API calls in unit tests
- Include both success and error cases

## Staying Updated

Keep your fork in sync with the main repository:

```bash
git pull origin main  # Pull latest changes
pnpm install          # Update dependencies

# If you encounter issues after updating:
rm -rf node_modules pnpm-lock.yaml && pnpm install
```

## Issues and Discussions

- Open an Issue for bugs or concrete tasks
- Use Discussions for architecture or design questions
- If unsure, start with a Discussion
- Check the [Trello board](https://trello.com/b/9ytGVZU4/openscribe) for current priorities

## Good First Issues

Issues labeled `good first issue` are intentionally scoped for new contributors
and include context and guidance.

## Pull Request Process

1. Update documentation if you're changing functionality
2. Add tests for new features
3. Ensure all tests pass
4. Update the README.md if needed
5. Reference any related issues in your PR description
6. Be responsive to feedback during review

## Questions?

- Open a Discussion for general questions
- Tag @sammargolis for maintainer attention
- Join conversations in existing Issues

---

By contributing, you agree that your contributions will be licensed under the MIT License.
